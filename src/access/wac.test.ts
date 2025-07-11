// Copyright Inrupt Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal in
// the Software without restriction, including without limitation the rights to use,
// copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
// Software, and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
// INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
// PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
// HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//

import { jest, describe, it, expect } from "@jest/globals";
import type {
  IriString,
  SolidDataset,
  WithServerResourceInfo,
} from "../interfaces";
import type { AgentAccess } from "../acl/agent";
import { getAgentResourceAccess } from "../acl/agent";
import type { WacAccess } from "./wac";
import {
  getAgentAccess,
  getAgentAccessAll,
  getGroupAccess,
  getGroupAccessAll,
  getPublicAccess,
  setAgentResourceAccess,
  setGroupResourceAccess,
  setPublicResourceAccess,
} from "./wac";
import { triplesToTurtle } from "../formats/turtle";
import { addMockAclRuleQuads, setMockAclUrl } from "../acl/mock.internal";
import { acl, foaf } from "../constants";

import { mockSolidDatasetFrom } from "../resource/mock";
import { internal_getResourceAcl } from "../acl/acl.internal";
import type { AclDataset } from "../acl/acl";
import { getGroupResourceAccess } from "../acl/group";
import { getPublicResourceAccess } from "../acl/class";
import { toRdfJsQuads } from "../rdfjs.internal";
import { mockResponse } from "../tests.internal";

jest.spyOn(globalThis, "fetch").mockImplementation(
  async () =>
    new Response(undefined, {
      headers: { Location: "https://arbitrary.pod/resource" },
    }),
);

function getMockDataset(
  sourceIri: IriString,
  aclIri?: IriString,
): SolidDataset & WithServerResourceInfo {
  const result = mockSolidDatasetFrom(sourceIri);
  if (aclIri === undefined) {
    return result;
  }
  return setMockAclUrl(result, aclIri);
}

const mockedResource = getMockDataset(
  "https://some.pod/resource",
  "https://some.pod/resource.acl",
);

describe("getAgentAccess", () => {
  it("calls the included fetcher by default", async () => {
    await getAgentAccess(mockedResource, "https://some.pod/profile#agent");
    expect(fetch).toHaveBeenCalledWith(
      "https://some.pod/resource.acl",
      expect.anything(),
    );
  });

  it("returns null if no ACL is accessible", async () => {
    const result = getAgentAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        fetch: async (url) => {
          switch (url.toString()) {
            case "https://some.pod/resource.acl":
            case "https://some.pod/.acl":
              return new Response("", { status: 404 });
            case "https://some.pod/":
              return new Response('<.acl>; rel="acl"', { status: 200 });
            default:
              throw new Error("Unepxected URL");
          }
        },
      },
    );

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the target resource", async () => {
    const resource = getMockDataset("https://some.pod/resource");
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: async (url) => {
        if (url.toString() === "https://some.pod/resource.acl") {
          return new Response("ACL not found", { status: 404 });
        }
        throw new Error("Unepxected URL");
      },
    });

    await expect(result).resolves.toBeNull();
  });

  it("fetches the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
    );

    const result = getAgentAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        fetch: async (url) => {
          if (url.toString() === "https://some.pod/resource.acl") {
            return Object.defineProperty(
              new Response(await triplesToTurtle(toRdfJsQuads(aclResource)), {
                status: 200,
                headers: { "Content-Type": "text/turtle" },
              }),
              "url",
              { value: url.toString() },
            );
          }
          throw new Error("Unepxected URL");
        },
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: true,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("fetches the fallback ACL if no resource ACL is available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default",
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/.acl",
        ),
      );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl",
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: mockFetch,
    });
    await expect(result).resolves.toStrictEqual({
      read: true,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("ignores the fallback ACL if the resource ACL is available", async () => {
    const fallbackAclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/",
      { read: false, append: true, write: false, control: false },
      "default",
    );

    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
    );

    const resource = getMockDataset(
      "https://some.pod/resource",
      "https://some.pod/resource.acl",
    );
    const result = getAgentAccess(resource, "https://some.pod/profile#agent", {
      fetch: async (url) => {
        let response: Response | undefined;
        switch (url.toString()) {
          case "https://some.pod/resource.acl":
            response = new Response(
              await triplesToTurtle(toRdfJsQuads(aclResource)),
              { status: 200, headers: { "Content-Type": "text/turtle" } },
            );
            break;
          case "https://some.pod/.acl":
            response = new Response(
              await triplesToTurtle(toRdfJsQuads(fallbackAclResource)),
              { status: 200, headers: { "Content-Type": "text/turtle" } },
            );
            break;
          case "https://some.pod/":
            response = new Response('<.acl>; rel="acl"', { status: 200 });
            break;
          default:
            throw new Error("Unepxected URL");
        }
        if (!response) {
          throw new Error("Unepxected URL");
        }
        return Object.defineProperty(response, "url", {
          value: url.toString(),
        });
      },
    });
    await expect(result).resolves.toStrictEqual({
      append: false,
      read: true,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("returns true for both controlRead and controlWrite if the Agent has control access", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: true },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getAgentAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: true,
      controlWrite: true,
    });
  });

  it("correctly reads the Agent append access", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getAgentAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: true,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("correctly reads the Agent write access, which implies append", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: true, control: false },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getAgentAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: true,
      write: true,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("returns false for all modes the Agent isn't present", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#another-agent",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getAgentAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("does not return access for groups", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getAgentAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("does not return access for everyone", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getAgentAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("does not return access for authenticated agents", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      acl.AuthenticatedAgent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getAgentAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });
});

describe("getGroupAccess", () => {
  it("calls the included fetcher by default", async () => {
    await getGroupAccess(mockedResource, "https://some.pod/groups#group");

    expect(fetch).toHaveBeenCalledWith(
      "https://some.pod/resource.acl",
      expect.anything(),
    );
  });

  it("returns null if no ACL is accessible", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/.acl",
        ),
      );

    const result = getGroupAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the target resource", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "ACL not found",
        {
          status: 404,
        },
        "https://some.pod/resource.acl",
      ),
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = getAgentAccess(resource, "https://some.pod/groups#group", {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("fetches the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getGroupAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: true,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("fetches the fallback ACL if no resource ACL is available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup,
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/.acl",
        ),
      );

    const result = getGroupAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        fetch: mockFetch,
      },
    );
    await expect(result).resolves.toStrictEqual({
      read: true,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("ignores the fallback ACL if the resource ACL is available", async () => {
    const fallbackAclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup,
    );

    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup,
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // The resource ACL is available...
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(fallbackAclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/.acl",
        ),
      );

    const result = getGroupAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        fetch: mockFetch,
      },
    );
    await expect(result).resolves.toStrictEqual({
      append: true,
      read: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("returns an empty object if the group isn't present", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#another-group",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getGroupAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("does not return access for agents", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agent,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getGroupAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("does not return access for everyone", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getGroupAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("does not return access for authenticated agents", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      acl.AuthenticatedAgent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getGroupAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });
});

describe("getPublicAccess", () => {
  it("calls the included fetcher by default", async () => {
    await getPublicAccess(mockedResource);

    expect(fetch).toHaveBeenCalledWith(
      "https://some.pod/resource.acl",
      expect.anything(),
    );
  });

  it("returns null if no ACL is accessible", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/.acl",
        ),
      );

    const result = getPublicAccess(mockedResource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the target resource", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "ACL not found",
        {
          status: 404,
        },
        "https://some.pod/resource.acl",
      ),
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = getPublicAccess(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("fetches the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getPublicAccess(mockedResource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: true,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("fetches the fallback ACL if no resource ACL is available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      foaf.Agent,
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass,
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/.acl",
        ),
      );

    const result = getPublicAccess(mockedResource, {
      fetch: mockFetch,
    });
    await expect(result).resolves.toStrictEqual({
      read: true,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("ignores the fallback ACL if the resource ACL is available", async () => {
    const fallbackAclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      foaf.Agent,
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass,
    );

    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass,
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // The resource ACL is available...
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(fallbackAclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/.acl",
        ),
      );

    const result = getPublicAccess(mockedResource, {
      fetch: mockFetch,
    });
    await expect(result).resolves.toStrictEqual({
      append: true,
      read: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("returns an empty object if no public access is specified", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getPublicAccess(mockedResource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("does not return access for agents", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agent,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getPublicAccess(mockedResource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("does not return access for groups", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentGroup,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getPublicAccess(mockedResource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });

  it("does not return access for authenticated agents", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      acl.AuthenticatedAgent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#some-rule",
      acl.agentClass,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getPublicAccess(mockedResource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      read: false,
      append: false,
      write: false,
      controlRead: false,
      controlWrite: false,
    });
  });
});

describe("getAgentAccessAll", () => {
  it("uses the default fetcher if none is provided", async () => {
    await getAgentAccessAll(mockedResource);

    expect(fetch).toHaveBeenCalledWith(
      "https://some.pod/resource.acl",
      expect.anything(),
    );
  });

  it("returns null if the advertized ACL isn't accessible", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/.acl",
        ),
      );

    const result = getAgentAccessAll(mockedResource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the resource", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "ACL not found",
        {
          status: 404,
        },
        "https://some.pod/resource.acl",
      ),
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = getAgentAccessAll(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("calls the underlying getAgentAccessAll", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "",
        {
          status: 200,
        },
        "https://some.pod/resource.acl",
      ),
    );

    const wacModule = jest.requireActual("../acl/agent") as {
      getAgentAccessAll: () => Promise<AgentAccess>;
    };
    const getAgentAccessAllWac = jest.spyOn(wacModule, "getAgentAccessAll");

    await getAgentAccessAll(mockedResource, {
      fetch: mockFetch,
    });

    expect(getAgentAccessAllWac).toHaveBeenCalled();
  });

  it("returns an empty list if the ACL defines no access", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "",
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    await expect(
      getAgentAccessAll(mockedResource, {
        fetch: mockFetch,
      }),
    ).resolves.toStrictEqual({});
  });

  it("returns the access set for all the actors present", async () => {
    let aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent-a",
      "https://some.pod/resource",
      { read: false, append: false, write: true, control: false },
      "resource",
    );
    aclResource = addMockAclRuleQuads(
      aclResource,
      "https://some.pod/profile#agent-b",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    await expect(
      getAgentAccessAll(mockedResource, {
        fetch: mockFetch,
      }),
    ).resolves.toStrictEqual({
      "https://some.pod/profile#agent-a": {
        read: false,
        append: true,
        write: true,
        controlRead: false,
        controlWrite: false,
      },
      "https://some.pod/profile#agent-b": {
        read: true,
        append: false,
        write: false,
        controlRead: false,
        controlWrite: false,
      },
    });
  });

  it("returns true for both controlRead and controlWrite if an Agent has control access", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: true },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getAgentAccessAll(mockedResource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      "https://some.pod/profile#agent": {
        read: false,
        append: false,
        write: false,
        controlRead: true,
        controlWrite: true,
      },
    });
  });
});

describe("getGroupAccessAll", () => {
  it("uses the default fetcher if none is provided", async () => {
    await getGroupAccessAll(mockedResource);

    expect(fetch).toHaveBeenCalledWith(
      "https://some.pod/resource.acl",
      expect.anything(),
    );
  });

  it("returns null if the advertized ACL isn't accessible", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/.acl",
        ),
      );

    const result = getGroupAccessAll(mockedResource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the resource", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "ACL not found",
        {
          status: 404,
        },
        "https://some.pod/resource.acl",
      ),
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = getGroupAccessAll(resource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toBeNull();
  });

  it("calls the underlying getGroupAccessAll", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "",
        {
          status: 200,
        },
        "https://some.pod/resource.acl",
      ),
    );

    const wacModule = jest.requireActual("../acl/group") as {
      getGroupAccessAll: () => Promise<AgentAccess>;
    };
    const getGroupAccessAllWac = jest.spyOn(wacModule, "getGroupAccessAll");

    await getGroupAccessAll(mockedResource, {
      fetch: mockFetch,
    });

    expect(getGroupAccessAllWac).toHaveBeenCalled();
  });

  it("returns an empty list if the ACL defines no access", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "",
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    await expect(
      getGroupAccessAll(mockedResource, {
        fetch: mockFetch,
      }),
    ).resolves.toStrictEqual({});
  });

  it("returns the access set for all the actors present", async () => {
    let aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group-a",
      "https://some.pod/resource",
      { read: false, append: false, write: true, control: false },
      "resource",
      "https://some.pod/resource.acl#rule-a",
      acl.agentGroup,
    );
    aclResource = addMockAclRuleQuads(
      aclResource,
      "https://some.pod/groups#group-b",
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule-b",
      acl.agentGroup,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    await expect(
      getGroupAccessAll(mockedResource, {
        fetch: mockFetch,
      }),
    ).resolves.toStrictEqual({
      "https://some.pod/groups#group-a": {
        read: false,
        append: true,
        write: true,
        controlRead: false,
        controlWrite: false,
      },
      "https://some.pod/groups#group-b": {
        read: true,
        append: false,
        write: false,
        controlRead: false,
        controlWrite: false,
      },
    });
  });

  it("returns true for both controlRead and controlWrite if a Group has control access", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: true },
      "resource",
      "https://some.pod/resource.acl#rule",
      acl.agentGroup,
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = getGroupAccessAll(mockedResource, {
      fetch: mockFetch,
    });

    await expect(result).resolves.toStrictEqual({
      "https://some.pod/groups#group": {
        read: false,
        append: false,
        write: false,
        controlRead: true,
        controlWrite: true,
      },
    });
  });
});

describe("setAgentAccess", () => {
  it("calls the included fetcher by default", async () => {
    await setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        read: true,
        append: undefined,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://some.pod/resource.acl",
      expect.anything(),
    );
  });

  it("returns null if no ACL is accessible", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/.acl",
        ),
      );

    const result = setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        read: true,
        append: undefined,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the target resource", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "ACL not found",
        {
          status: 404,
        },
        "https://some.pod/resource.acl",
      ),
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = setAgentResourceAccess(
      resource,
      "https://some.pod/profile#agent",
      {
        read: true,
        append: undefined,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toBeNull();
  });

  it("sets read access in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        read: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent",
    );

    expect(newAccess).toStrictEqual({
      read: true,
      append: false,
      write: false,
      control: false,
    });
  });

  it("sets append access in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        append: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent",
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: true,
      write: false,
      control: false,
    });
  });

  it("sets write access in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        write: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent",
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: true,
      write: true,
      control: false,
    });
  });

  it("sets control access in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        controlRead: true,
        controlWrite: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent",
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: false,
      write: false,
      control: true,
    });
  });

  it("preserves previously existing access for the resource if undefined in the access being set", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      // Note that append access is set
      { read: false, append: true, write: false, control: false },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        read: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent",
    );

    expect(newAccess).toStrictEqual({
      read: true,
      append: true,
      write: false,
      control: false,
    });
  });

  it("removes access previously granted if the new access is set to false", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        append: false,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent",
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: false,
      write: false,
      control: false,
    });
  });

  it("overwrites all previously existing access for the resource if no mode is left undefined in the access being set", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      // Note that append access is set
      { read: false, append: false, write: false, control: false },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        read: true,
        append: true,
        write: true,
        controlRead: true,
        controlWrite: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent",
    );

    expect(newAccess).toStrictEqual({
      read: true,
      append: true,
      write: true,
      control: true,
    });
  });

  it("copies the fallback ACL if no resource ACL is available, and sets intended access in the newly created copy", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/",
      { read: false, append: false, write: false, control: false },
      "default",
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/.acl",
        ),
      )
      // Save the ACL
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 201,
          },
          "https://some.pod/.acl",
        ),
      );

    const result = await setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        append: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#agent",
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: true,
      write: false,
      control: false,
    });
  });

  it("ignores the fallback ACL if the resource ACL is available", async () => {
    const fallbackAclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/profile#another-agent",
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default",
    );

    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource",
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // The resource ACL is available...
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(fallbackAclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/.acl",
        ),
      );

    const result = await setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        append: true,
      },
      {
        fetch: mockFetch,
      },
    );

    // Here, we check that the agent set in the fallback ACL isn't present in
    // the resource ACL
    const newAccess = getAgentResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/profile#another-agent",
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: false,
      write: false,
      control: false,
    });
  });

  it("throws if the access being set can't be expressed in WAC", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    await expect(
      setAgentResourceAccess(
        mockedResource,
        "https://some.pod/profile#agent",
        {
          controlRead: true,
          controlWrite: undefined,
        } as unknown as WacAccess,
        {
          fetch: mockFetch,
        },
      ),
    ).rejects.toThrow(
      "For Pods using Web Access Control, controlRead and controlWrite must be equal.",
    );
  });

  it("returns null if the ACL cannot be written back", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/profile#agent",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // The resource ACL is available...
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Cannot save the ACL
      .mockResolvedValueOnce(
        mockResponse(
          "Not authorized",
          {
            status: 403,
          },
          "https://some.pod/.acl",
        ),
      );

    const result = await setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        read: true,
        append: undefined,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
      {
        fetch: mockFetch,
      },
    );
    expect(result).toBeNull();
  });

  it("calls the underlying WAC API functions", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "",
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const wacModule = jest.requireActual("../acl/agent") as {
      setAgentResourceAccess: () => Promise<AgentAccess>;
    };
    const aclModule = jest.requireActual("../acl/acl") as {
      saveAclFor: () => Promise<AclDataset>;
    };
    const setAgentResourceAccessWac = jest.spyOn(
      wacModule,
      "setAgentResourceAccess",
    );
    const saveAclForWac = jest.spyOn(aclModule, "saveAclFor");

    await setAgentResourceAccess(
      mockedResource,
      "https://some.pod/profile#agent",
      {
        read: undefined,
        append: true,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
      {
        fetch: mockFetch,
      },
    );
    expect(setAgentResourceAccessWac).toHaveBeenCalled();
    expect(saveAclForWac).toHaveBeenCalled();
  });
});

describe("setGroupResourceAccess", () => {
  it("calls the included fetcher by default", async () => {
    await setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        read: true,
      },
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://some.pod/resource.acl",
      expect.anything(),
    );
  });

  it("returns null if no ACL is accessible", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/.acl",
        ),
      );

    const result = setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        read: true,
      },
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the target resource", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "ACL not found",
        {
          status: 404,
        },
        "https://some.pod/resource.acl",
      ),
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = setGroupResourceAccess(
      resource,
      "https://some.pod/groups#group",
      {
        read: true,
      },
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toBeNull();
  });

  it("sets read access for the group in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentGroup",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        read: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getGroupResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/groups#group",
    );

    expect(newAccess).toStrictEqual({
      read: true,
      append: false,
      write: false,
      control: false,
    });
  });

  it("sets append access for the group in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentGroup",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        append: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getGroupResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/groups#group",
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: true,
      write: false,
      control: false,
    });
  });

  it("sets write access for the group in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentGroup",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        write: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getGroupResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/groups#group",
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: true,
      write: true,
      control: false,
    });
  });

  it("sets control access for the group in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentGroup",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        controlRead: true,
        controlWrite: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getGroupResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/groups#group",
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: false,
      write: false,
      control: true,
    });
  });

  it("preserves previously existing access for the group to the resource if undefined in the access being set", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      // Note that append access is set
      { read: false, append: true, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentGroup",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        read: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getGroupResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/groups#group",
    );

    expect(newAccess).toStrictEqual({
      read: true,
      append: true,
      write: false,
      control: false,
    });
  });

  it("removes access previously granted to the group if the new access is set to false", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentGroup",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        append: false,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getGroupResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/groups#group",
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: false,
      write: false,
      control: false,
    });
  });

  it("overwrites all previously existing access to the resource for the group if no mode is left undefined in the access being set", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentGroup",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        read: true,
        append: true,
        write: true,
        controlRead: true,
        controlWrite: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getGroupResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/groups#group",
    );

    expect(newAccess).toStrictEqual({
      read: true,
      append: true,
      write: true,
      control: true,
    });
  });

  it("copies the fallback ACL if no resource ACL is available, and sets intended access for the group in the newly created copy", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/",
      { read: false, append: false, write: false, control: false },
      "default",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentGroup",
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/.acl",
        ),
      )
      // Save the ACL
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 201,
          },
          "https://some.pod/.acl",
        ),
      );

    const result = await setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        append: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getGroupResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/groups#group",
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: true,
      write: false,
      control: false,
    });
  });

  it("ignores the fallback ACL if the resource ACL is available", async () => {
    const fallbackAclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/.acl"),
      "https://some.pod/groups#another-group",
      "https://some.pod/",
      { read: true, append: false, write: false, control: false },
      "default",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentGroup",
    );

    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentGroup",
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // The resource ACL is available...
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(fallbackAclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/.acl",
        ),
      );

    const result = await setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        append: true,
      },
      {
        fetch: mockFetch,
      },
    );

    // Here, we check that the agent set in the fallback ACL isn't present in
    // the resource ACL
    const newAccess = getGroupResourceAccess(
      internal_getResourceAcl(result!),
      "https://some.pod/groups#another-group",
    );

    expect(newAccess).toStrictEqual({
      read: false,
      append: false,
      write: false,
      control: false,
    });
  });

  it("throws if the access being set for the group can't be expressed in WAC", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentGroup",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    await expect(
      setAgentResourceAccess(
        mockedResource,
        "https://some.pod/groups#group",
        {
          controlRead: true,
          controlWrite: undefined,
        } as unknown as WacAccess,
        {
          fetch: mockFetch,
        },
      ),
    ).rejects.toThrow(
      "For Pods using Web Access Control, controlRead and controlWrite must be equal.",
    );
  });

  it("returns null if the ACL cannot be written back", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      "https://some.pod/groups#group",
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentGroup",
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // The resource ACL is available...
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Cannot save the ACL
      .mockResolvedValueOnce(
        mockResponse(
          "Not authorized",
          {
            status: 403,
          },
          "https://some.pod/.acl",
        ),
      );

    const result = await setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        read: true,
        append: undefined,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
      {
        fetch: mockFetch,
      },
    );
    expect(result).toBeNull();
  });

  it("calls the underlying WAC API group functions", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "",
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const wacModule = jest.requireActual("../acl/group") as {
      setGroupResourceAccess: () => Promise<AgentAccess>;
    };
    const aclModule = jest.requireActual("../acl/acl") as {
      saveAclFor: () => Promise<AclDataset>;
    };
    const setGroupResourceAccessWac = jest.spyOn(
      wacModule,
      "setGroupResourceAccess",
    );
    const saveAclForWac = jest.spyOn(aclModule, "saveAclFor");

    await setGroupResourceAccess(
      mockedResource,
      "https://some.pod/groups#group",
      {
        read: undefined,
        append: true,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
      {
        fetch: mockFetch,
      },
    );
    expect(setGroupResourceAccessWac).toHaveBeenCalled();
    expect(saveAclForWac).toHaveBeenCalled();
  });
});

describe("setPublicResourceAccess", () => {
  it("calls the included fetcher by default", async () => {
    await setPublicResourceAccess(mockedResource, {
      read: true,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://some.pod/resource.acl",
      expect.anything(),
    );
  });

  it("returns null if no ACL is accessible", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/.acl",
        ),
      );

    const result = setPublicResourceAccess(
      mockedResource,
      {
        read: true,
      },
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toBeNull();
  });

  it("returns null if no ACL is advertised by the target resource", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "ACL not found",
        {
          status: 404,
        },
        "https://some.pod/resource.acl",
      ),
    );

    const resource = getMockDataset("https://some.pod/resource");
    const result = setPublicResourceAccess(
      resource,
      {
        read: true,
      },
      {
        fetch: mockFetch,
      },
    );

    await expect(result).resolves.toBeNull();
  });

  it("sets read access for everyone in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentClass",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setPublicResourceAccess(
      mockedResource,
      {
        read: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getPublicResourceAccess(internal_getResourceAcl(result!));

    expect(newAccess).toStrictEqual({
      read: true,
      append: false,
      write: false,
      control: false,
    });
  });

  it("sets append access for everyone in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentClass",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setPublicResourceAccess(
      mockedResource,
      {
        append: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getPublicResourceAccess(internal_getResourceAcl(result!));

    expect(newAccess).toStrictEqual({
      read: false,
      append: true,
      write: false,
      control: false,
    });
  });

  it("sets write access for everyone in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentClass",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setPublicResourceAccess(
      mockedResource,
      {
        write: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getPublicResourceAccess(internal_getResourceAcl(result!));

    expect(newAccess).toStrictEqual({
      read: false,
      append: true,
      write: true,
      control: false,
    });
  });

  it("sets control access for everyone in the resource ACL if available", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentClass",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setPublicResourceAccess(
      mockedResource,
      {
        controlRead: true,
        controlWrite: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getPublicResourceAccess(internal_getResourceAcl(result!));

    expect(newAccess).toStrictEqual({
      read: false,
      append: false,
      write: false,
      control: true,
    });
  });

  it("preserves previously existing access for everyone to the resource if undefined in the access being set", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentClass",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setPublicResourceAccess(
      mockedResource,
      {
        read: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getPublicResourceAccess(internal_getResourceAcl(result!));

    expect(newAccess).toStrictEqual({
      read: true,
      append: true,
      write: false,
      control: false,
    });
  });

  it("removes access previously granted to everyone if the new access is set to false", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentClass",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setPublicResourceAccess(
      mockedResource,
      {
        append: false,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getPublicResourceAccess(internal_getResourceAcl(result!));

    expect(newAccess).toStrictEqual({
      read: false,
      append: false,
      write: false,
      control: false,
    });
  });

  it("overwrites all previously existing access to the resource for everyone if no mode is left undefined in the access being set", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentClass",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const result = await setPublicResourceAccess(
      mockedResource,
      {
        read: true,
        append: true,
        write: true,
        controlRead: true,
        controlWrite: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getPublicResourceAccess(internal_getResourceAcl(result!));

    expect(newAccess).toStrictEqual({
      read: true,
      append: true,
      write: true,
      control: true,
    });
  });

  it("copies the fallback ACL if no resource ACL is available, and sets intended access for everyone in the newly created copy", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentClass",
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // No resource ACL available...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 404,
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/.acl",
        ),
      )
      // Save the ACL
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 201,
          },
          "https://some.pod/.acl",
        ),
      );

    const result = await setPublicResourceAccess(
      mockedResource,
      {
        append: true,
      },
      {
        fetch: mockFetch,
      },
    );

    const newAccess = getPublicResourceAccess(internal_getResourceAcl(result!));

    expect(newAccess).toStrictEqual({
      read: false,
      append: true,
      write: false,
      control: false,
    });
  });

  it("ignores the fallback ACL if the resource ACL is available", async () => {
    const fallbackAclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: true, append: false, write: false, control: false },
      "default",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentClass",
    );

    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: true, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentClass",
    );

    const mockFetch = jest
      .fn<typeof fetch>()
      // The resource ACL is available...
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(aclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/resource.acl",
        ),
      )
      // Link to the fallback ACL...
      .mockResolvedValueOnce(
        mockResponse(
          "",
          {
            status: 200,
            headers: {
              Link: '<.acl>; rel="acl"',
            },
          },
          "https://some.pod/",
        ),
      )
      // Get the fallback ACL
      .mockResolvedValueOnce(
        mockResponse(
          await triplesToTurtle(toRdfJsQuads(fallbackAclResource)),
          {
            status: 200,
            headers: { "Content-Type": "text/turtle" },
          },
          "https://some.pod/.acl",
        ),
      );

    const result = await setPublicResourceAccess(
      mockedResource,
      {
        write: true,
      },
      {
        fetch: mockFetch,
      },
    );

    // Here, we check that the agent set in the fallback ACL isn't present in
    // the resource ACL
    const newAccess = getPublicResourceAccess(internal_getResourceAcl(result!));

    expect(newAccess).toStrictEqual({
      // If the fallback ACL was copied, read would be true
      read: false,
      append: true,
      write: true,
      control: false,
    });
  });

  it("throws if the access being set for everyone can't be expressed in WAC", async () => {
    const aclResource = addMockAclRuleQuads(
      getMockDataset("https://some.pod/resource.acl"),
      foaf.Agent,
      "https://some.pod/resource",
      { read: false, append: false, write: false, control: false },
      "resource",
      "https://some.pod/resource.acl#rule",
      "http://www.w3.org/ns/auth/acl#agentClass",
    );

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        await triplesToTurtle(toRdfJsQuads(aclResource)),
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    await expect(
      setPublicResourceAccess(
        mockedResource,
        {
          controlRead: true,
          controlWrite: undefined,
        } as unknown as WacAccess,
        {
          fetch: mockFetch,
        },
      ),
    ).rejects.toThrow(
      "For Pods using Web Access Control, controlRead and controlWrite must be equal.",
    );
  });

  it("calls the underlying WAC API class functions", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(
      mockResponse(
        "",
        {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        },
        "https://some.pod/resource.acl",
      ),
    );

    const wacModule = jest.requireActual("../acl/class") as {
      setPublicResourceAccess: () => Promise<AgentAccess>;
    };
    const aclModule = jest.requireActual("../acl/acl") as {
      saveAclFor: () => Promise<AclDataset>;
    };
    const setPublicResourceAccessWac = jest.spyOn(
      wacModule,
      "setPublicResourceAccess",
    );
    const saveAclForWac = jest.spyOn(aclModule, "saveAclFor");

    await setPublicResourceAccess(
      mockedResource,
      {
        read: undefined,
        append: true,
        write: undefined,
        controlRead: undefined,
        controlWrite: undefined,
      },
      {
        fetch: mockFetch,
      },
    );
    expect(setPublicResourceAccessWac).toHaveBeenCalled();
    expect(saveAclForWac).toHaveBeenCalled();
  });
});
