/**
 * Copyright 2020 Inrupt Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
 * Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import LinkHeader from "http-link-header";
import {
  WithAcl,
  hasAccessibleAcl,
  WithServerResourceInfo,
  Access,
  SolidDataset,
} from "../interfaces";
import {
  internal_fetchResourceAcl,
  internal_fetchFallbackAcl,
} from "../acl/acl.internal";
import { internal_defaultFetchOptions } from "./resource";
import { clone as cloneDataset } from "../rdfjs";

/**
 * This (currently internal) function fetches the ACL indicated in the [[WithServerResourceInfo]]
 * attached to a resource.
 *
 * @internal
 * @param resourceInfo The Resource info with the ACL URL
 * @param options Optional parameter `options.fetch`: An alternative `fetch` function to make the HTTP request, compatible with the browser-native [fetch API](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Parameters).
 */
export async function internal_fetchAcl(
  resourceInfo: WithServerResourceInfo,
  options: Partial<
    typeof internal_defaultFetchOptions
  > = internal_defaultFetchOptions
): Promise<WithAcl["internal_acl"]> {
  if (!hasAccessibleAcl(resourceInfo)) {
    return {
      resourceAcl: null,
      fallbackAcl: null,
    };
  }
  const resourceAcl = await internal_fetchResourceAcl(resourceInfo, options);

  const acl =
    resourceAcl === null
      ? {
          resourceAcl: null,
          fallbackAcl: await internal_fetchFallbackAcl(resourceInfo, options),
        }
      : { resourceAcl: resourceAcl, fallbackAcl: null };

  return acl;
}

/**
 * @internal
 */
export function internal_parseResourceInfo(
  response: Response
): WithServerResourceInfo["internal_resourceInfo"] {
  const contentTypeParts =
    response.headers.get("Content-Type")?.split(";") ?? [];
  // If the server offers a Turtle or JSON-LD serialisation on its own accord,
  // that tells us whether it is RDF data that the server can understand
  // (and hence can be updated with a PATCH request with SPARQL INSERT and DELETE statements),
  // in which case our SolidDataset-related functions should handle it.
  // For more context, see https://github.com/inrupt/solid-client-js/pull/214.
  const isSolidDataset =
    contentTypeParts.length > 0 &&
    ["text/turtle", "application/ld+json"].includes(contentTypeParts[0]);

  const resourceInfo: WithServerResourceInfo["internal_resourceInfo"] = {
    sourceIri: response.url,
    isRawData: !isSolidDataset,
    contentType: response.headers.get("Content-Type") ?? undefined,
    linkedResources: {},
  };

  const linkHeader = response.headers.get("Link");
  if (linkHeader) {
    const parsedLinks = LinkHeader.parse(linkHeader);
    // Set ACL link
    const aclLinks = parsedLinks.get("rel", "acl");
    if (aclLinks.length === 1) {
      resourceInfo.aclUrl = new URL(
        aclLinks[0].uri,
        resourceInfo.sourceIri
      ).href;
    }
    // Parse all link headers and expose them in a standard way
    // (this can replace the parsing of the ACL link above):
    resourceInfo.linkedResources = parsedLinks.refs.reduce((rels, ref) => {
      rels[ref.rel] ??= [];
      rels[ref.rel].push(new URL(ref.uri, resourceInfo.sourceIri).href);
      return rels;
    }, resourceInfo.linkedResources);
  }

  const wacAllowHeader = response.headers.get("WAC-Allow");
  if (wacAllowHeader) {
    resourceInfo.permissions = parseWacAllowHeader(wacAllowHeader);
  }

  return resourceInfo;
}

/**
 * Parse a WAC-Allow header into user and public access booleans.
 *
 * @param wacAllowHeader A WAC-Allow header in the format `user="read append write control",public="read"`
 * @see https://github.com/solid/solid-spec/blob/cb1373a369398d561b909009bd0e5a8c3fec953b/api-rest.md#wac-allow-headers
 */
function parseWacAllowHeader(wacAllowHeader: string) {
  function parsePermissionStatement(permissionStatement: string): Access {
    const permissions = permissionStatement.split(" ");
    const writePermission = permissions.includes("write");
    return writePermission
      ? {
          read: permissions.includes("read"),
          append: true,
          write: true,
          control: permissions.includes("control"),
        }
      : {
          read: permissions.includes("read"),
          append: permissions.includes("append"),
          write: false,
          control: permissions.includes("control"),
        };
  }
  function getStatementFor(header: string, scope: "user" | "public") {
    const relevantEntries = header
      .split(",")
      .map((rawEntry) => rawEntry.split("="))
      .filter((parts) => parts.length === 2 && parts[0].trim() === scope);

    // There should only be one statement with the given scope:
    if (relevantEntries.length !== 1) {
      return "";
    }
    const relevantStatement = relevantEntries[0][1].trim();

    // The given statement should be wrapped in double quotes to be valid:
    if (
      relevantStatement.charAt(0) !== '"' ||
      relevantStatement.charAt(relevantStatement.length - 1) !== '"'
    ) {
      return "";
    }
    // Return the statment without the wrapping quotes, e.g.: read append write control
    return relevantStatement.substring(1, relevantStatement.length - 1);
  }

  return {
    user: parsePermissionStatement(getStatementFor(wacAllowHeader, "user")),
    public: parsePermissionStatement(getStatementFor(wacAllowHeader, "public")),
  };
}

/** @hidden Used to instantiate a separate instance from input parameters */
export function internal_cloneResource<ResourceExt extends object>(
  resource: ResourceExt
): ResourceExt {
  let clonedResource;
  if (typeof (resource as File).slice === "function") {
    // If given Resource is a File:
    clonedResource = (resource as File).slice();
  } else if (typeof (resource as SolidDataset).match === "function") {
    // If given Resource is a SolidDataset:
    // (We use the existince of a `match` method as a heuristic:)
    clonedResource = cloneDataset(resource as SolidDataset);
  } else {
    // If it is just a plain object containing metadata:
    clonedResource = { ...resource };
  }

  return Object.assign(
    clonedResource,
    // Although the RDF/JS data structures use classes and mutation,
    // we only attach atomic properties that we never mutate.
    // Hence, `copyNonClassProperties` is a heuristic that allows us to only clone our own data
    // structures, rather than references to the same mutable instances of RDF/JS data structures:
    copyNonClassProperties(resource)
  ) as ResourceExt;
}

function copyNonClassProperties(source: object): object {
  const copy: Record<string, unknown> = {};
  Object.keys(source).forEach((key) => {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value !== "object" || value === null) {
      copy[key] = value;
      return;
    }
    if (value.constructor.name !== "Object") {
      return;
    }
    copy[key] = value;
  });

  return copy;
}

/** @internal */
export function internal_isUnsuccessfulResponse(
  response: Response
): response is Response & { ok: false } {
  return !response.ok;
}