/**
 * Copyright 2017-present Palantir Technologies, Inc. All rights reserved.
 * Licensed under the BSD-3 License as modified (the “License”); you may obtain
 * a copy of the license in the LICENSE and PATENTS files in the root of this
 * repository.
 */

import { relative } from "path";
import {
    ContainerReflection,
    DeclarationReflection,
    ParameterReflection,
    ProjectReflection,
    Reflection,
    ReflectionKind,
    SignatureReflection,
} from "typedoc";
import { Comment } from "typedoc/dist/lib/models/comments/comment";
import { DefaultValueContainer } from "typedoc/dist/lib/models/reflections/abstract";
import {
    ITsClass,
    ITsFlags,
    ITsInterface,
    ITsMethod,
    ITsMethodParameter,
    ITsMethodSignature,
    ITsProperty,
    Kind,
} from "../../client/typescript";
import { ICompiler } from "../plugin";
import { ITypescriptPluginOptions } from "./index";
import { resolveSignature, resolveTypeString } from "./typestring";

export type Renderer = ICompiler["renderBlock"];

export class Visitor {
    public constructor(private compiler: ICompiler, private options: ITypescriptPluginOptions) {}

    public visitProject(project: ProjectReflection) {
        const interfaces = this.visitChildren(
            project.getReflectionsByKind(ReflectionKind.Interface),
            this.visitInterface,
        );
        const classes = this.visitChildren(project.getReflectionsByKind(ReflectionKind.Class), this.visitClass);
        return [...interfaces, ...classes];
    }

    private makeDocEntry<K extends Kind>(def: Reflection, kind: K) {
        return {
            documentation: this.renderComment(def.comment),
            fileName: getFileName(def),
            flags: getFlags(def),
            kind,
            name: def.name,
        };
    }

    private visitClass = (def: ContainerReflection): ITsClass => ({
        ...this.visitInterface(def),
        kind: Kind.Class,
    });

    private visitInterface = (def: ContainerReflection): ITsInterface => ({
        ...this.makeDocEntry(def, Kind.Interface),
        methods: this.visitChildren(def.getChildrenByKind(ReflectionKind.Method), this.visitMethod),
        properties: this.visitChildren(def.getChildrenByKind(ReflectionKind.Property), this.visitProperty),
    });

    private visitProperty = (def: DeclarationReflection): ITsProperty => ({
        ...this.makeDocEntry(def, Kind.Property),
        defaultValue: getDefaultValue(def),
        type: resolveTypeString(def.type),
    });

    private visitMethod = (def: DeclarationReflection): ITsMethod => ({
        ...this.makeDocEntry(def, Kind.Method),
        signatures: def.signatures.map(sig => this.visitSignature(sig)),
    });

    private visitSignature = (sig: SignatureReflection): ITsMethodSignature => ({
        ...this.makeDocEntry(sig, Kind.Signature),
        parameters: (sig.parameters || []).map(param => this.visitParameter(param)),
        returnType: resolveTypeString(sig.type),
        type: resolveSignature(sig),
    });

    private visitParameter = (param: ParameterReflection): ITsMethodParameter => ({
        ...this.makeDocEntry(param, Kind.Parameter),
        defaultValue: getDefaultValue(param),
        type: resolveTypeString(param.type),
    });

    /** Visits each child that passes the filter condition (based on options). */
    private visitChildren<T>(children: Reflection[], visitor: (def: Reflection) => T): T[] {
        return children.filter(this.filterReflection).map(visitor);
    }

    /**
     * Converts a typedoc comment object to a rendered `IBlock`.
     */
    private renderComment(comment: Comment) {
        if (!comment) {
            return undefined;
        }
        let documentation = "";
        if (comment.shortText) {
            documentation += comment.shortText;
        }
        if (comment.text) {
            documentation += "\n\n" + comment.text;
        }
        if (comment.tags) {
            documentation +=
                "\n\n" +
                comment.tags
                    .filter(tag => tag.tagName !== "default" && tag.tagName !== "deprecated")
                    .map(tag => `@${tag.tagName} ${tag.text}`)
                    .join("\n");
        }
        return this.compiler.renderBlock(documentation);
    }

    private filterReflection = (def: Reflection) =>
        def.flags.isExported === true || this.options.includeNonExported === true;
}

function getCommentTag(comment: Comment, tagName: string) {
    if (comment == null || comment.tags == null) {
        return undefined;
    }
    return comment.tags.find(tag => tag.tagName === tagName);
}

function getDefaultValue(ref: DefaultValueContainer): string | undefined {
    if (ref.defaultValue != null) {
        return ref.defaultValue;
    }
    const defaultValue = getCommentTag(ref.comment, "default");
    if (defaultValue !== undefined) {
        return defaultValue.text.trim();
    }
    return undefined;
}

function getFileName({ sources = [] }: Reflection): string | undefined {
    const source = sources[0];
    const fileName = source && source.file && source.file.fullFileName;
    // filename relative to cwd, so it can be saved in a snapshot (machine-independent)
    return fileName && relative(process.cwd(), fileName);
}

function getFlags(ref: Reflection): ITsFlags | undefined {
    if (ref === undefined || ref.flags === undefined) {
        return undefined;
    }
    const isDeprecated = getIsDeprecated(ref);
    const { isExported, isExternal, isOptional, isPrivate, isProtected, isPublic, isRest, isStatic } = ref.flags;
    return { isDeprecated, isExported, isExternal, isOptional, isPrivate, isProtected, isPublic, isRest, isStatic };
}

function getIsDeprecated(ref: Reflection) {
    const deprecatedTag = getCommentTag(ref.comment, "deprecated");
    if (deprecatedTag === undefined) {
        return undefined;
    }
    const text = deprecatedTag.text.trim();
    return text === "" ? true : text;
}