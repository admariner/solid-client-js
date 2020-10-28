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

import { describe, it, expect } from "@jest/globals";
import {
  asIri,
  createThing,
  isThing,
  setThing,
  thingAsMarkdown,
} from "../thing/thing";
import {
  addAgentForRule,
  addForbiddenRuleForPolicy,
  addGroupForRule,
  addOptionalRuleForPolicy,
  addRequiredRuleForPolicy,
  createRule,
  getAgentForRuleAll,
  getForbiddenRuleForPolicyAll,
  getGroupForRuleAll,
  getOptionalRuleForPolicyAll,
  getRequiredRuleForPolicyAll,
  removeForbiddenRuleForPolicy,
  removeOptionalRuleForPolicy,
  removeRequiredRuleForPolicy,
  getRule,
  hasAuthenticatedForRule,
  hasPublicForRule,
  removeAgentForRule,
  removeGroupForRule,
  Rule,
  setAgentForRule,
  setAuthenticatedForRule,
  setForbiddenRuleForPolicy,
  setGroupForRule,
  setOptionalRuleForPolicy,
  setPublicForRule,
  setRequiredRuleForPolicy,
} from "./rule";

import { DataFactory, NamedNode } from "n3";

import { Policy } from "./policy";
import { createSolidDataset } from "../resource/solidDataset";
import { setUrl } from "../thing/set";
import { ThingPersisted, Url, UrlString, WebId } from "../interfaces";

// Vocabulary terms
const ACP_ANY = DataFactory.namedNode("http://www.w3.org/ns/solid/acp#anyOf");
const ACP_ALL = DataFactory.namedNode("http://www.w3.org/ns/solid/acp#allOf");
const ACP_NONE = DataFactory.namedNode("http://www.w3.org/ns/solid/acp#noneOf");
const RDF_TYPE = DataFactory.namedNode(
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
);
const ACP_RULE = DataFactory.namedNode("http://www.w3.org/ns/solid/acp#Rule");
const ACP_AGENT = DataFactory.namedNode("http://www.w3.org/ns/solid/acp#agent");
const ACP_GROUP = DataFactory.namedNode("http://www.w3.org/ns/solid/acp#group");
const ACP_PUBLIC = DataFactory.namedNode(
  "http://www.w3.org/ns/solid/acp#PublicAgent"
);
const ACP_AUTHENTICATED = DataFactory.namedNode(
  "http://www.w3.org/ns/solid/acp#AuthenticatedAgent"
);

// Test data
const MOCKED_POLICY_IRI = DataFactory.namedNode(
  "https://some.pod/policy-resource#policy"
);
const MOCKED_RULE_IRI = DataFactory.namedNode(
  "https://some.pod/rule-resource#a-rule"
);
const OTHER_MOCKED_RULE_IRI = DataFactory.namedNode(
  "https://some.pod/rule-resource#another-rule"
);
const REQUIRED_RULE_IRI = DataFactory.namedNode(
  "https://some.pod/rule-resource#required-rule"
);
const OPTIONAL_RULE_IRI = DataFactory.namedNode(
  "https://some.pod/rule-resource#optional-rule"
);
const FORBIDDEN_RULE_IRI = DataFactory.namedNode(
  "https://some.pod/rule-resource#forbidden-rule"
);
const MOCK_WEBID_ME = DataFactory.namedNode("https://my.pod/profile#me");
const MOCK_WEBID_YOU = DataFactory.namedNode("https://your.pod/profile#you");
const MOCK_GROUP_IRI = DataFactory.namedNode("https://my.pod/group#a-group");
const MOCK_GROUP_OTHER_IRI = DataFactory.namedNode(
  "https://my.pod/group#another-group"
);

type ThingObject = ThingPersisted | Url | UrlString;

function isNamedNode(object: ThingObject): object is Url {
  return typeof (object as Url).value !== undefined;
}

const addAllObjects = (
  thing: ThingPersisted,
  predicate: NamedNode,
  objects: ThingObject[]
): void => {
  objects.forEach((objectToAdd) => {
    let objectUrl: string;
    if (isThing(objectToAdd)) {
      objectUrl = asIri(objectToAdd);
    } else if (isNamedNode(objectToAdd)) {
      // The object is an Url (aka NamedNode)
      objectUrl = objectToAdd.value;
    } else {
      objectUrl = objectToAdd;
    }
    thing.add(
      DataFactory.quad(
        DataFactory.namedNode(asIri(thing)),
        predicate,
        DataFactory.namedNode(objectUrl)
      )
    );
  });
};

const mockRule = (
  url: Url,
  content?: {
    agents?: Url[];
    groups?: Url[];
    public?: boolean;
    authenticated?: boolean;
  }
): Rule => {
  let mockedRule = createThing({
    url: url.value,
  });
  mockedRule = mockedRule.add(
    DataFactory.quad(
      DataFactory.namedNode(asIri(mockedRule)),
      RDF_TYPE,
      ACP_RULE
    )
  );
  if (content?.agents) {
    addAllObjects(mockedRule, ACP_AGENT, content.agents);
  }
  if (content?.groups) {
    addAllObjects(mockedRule, ACP_GROUP, content.groups);
  }
  if (content?.public) {
    mockedRule = mockedRule.add(
      DataFactory.quad(
        DataFactory.namedNode(asIri(mockedRule)),
        ACP_AGENT,
        ACP_PUBLIC
      )
    );
  }
  if (content?.authenticated) {
    mockedRule = mockedRule.add(
      DataFactory.quad(
        DataFactory.namedNode(asIri(mockedRule)),
        ACP_AGENT,
        ACP_AUTHENTICATED
      )
    );
  }
  return mockedRule;
};

const mockPolicy = (
  url: NamedNode,
  rules?: { required?: Rule[]; optional?: Rule[]; forbidden?: Rule[] }
): Policy => {
  const mockPolicy = createThing({ url: url.value });
  if (rules?.forbidden) {
    addAllObjects(mockPolicy, ACP_NONE, rules.forbidden);
  }
  if (rules?.optional) {
    addAllObjects(mockPolicy, ACP_ANY, rules.optional);
  }
  if (rules?.required) {
    addAllObjects(mockPolicy, ACP_ALL, rules.required);
  }
  return mockPolicy;
};

describe("addForbiddenRuleForPolicy", () => {
  it("adds the rule in the forbidden rules of the policy", () => {
    const myPolicy = addForbiddenRuleForPolicy(
      mockPolicy(MOCKED_POLICY_IRI),
      mockRule(MOCKED_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_NONE, MOCKED_RULE_IRI)
      )
    ).toBe(true);
  });

  it("does not remove the existing forbidden rules", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      forbidden: [mockRule(OTHER_MOCKED_RULE_IRI)],
    });
    const myPolicy = addForbiddenRuleForPolicy(
      mockedPolicy,
      mockRule(MOCKED_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_NONE, OTHER_MOCKED_RULE_IRI)
      )
    ).toBe(true);
  });

  it("does not change the existing required and optional rules", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      optional: [mockRule(OPTIONAL_RULE_IRI)],
      required: [mockRule(REQUIRED_RULE_IRI)],
    });
    const myPolicy = addForbiddenRuleForPolicy(
      mockedPolicy,
      mockRule(FORBIDDEN_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ALL, REQUIRED_RULE_IRI)
      )
    ).toBe(true);
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ANY, OPTIONAL_RULE_IRI)
      )
    ).toBe(true);
  });

  it("does not change the input policy", () => {
    const myPolicy = mockPolicy(MOCKED_POLICY_IRI);
    const mypolicySize = myPolicy.size;
    addForbiddenRuleForPolicy(myPolicy, mockRule(MOCKED_RULE_IRI));
    expect(myPolicy.size).toEqual(mypolicySize);
  });
});

describe("addOptionalRuleForPolicy", () => {
  it("adds the rule in the optional rules of the policy", () => {
    const myPolicy = addOptionalRuleForPolicy(
      mockPolicy(MOCKED_POLICY_IRI),
      mockRule(MOCKED_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ANY, MOCKED_RULE_IRI)
      )
    ).toBe(true);
  });

  it("does not remove the existing optional rules", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      optional: [mockRule(OTHER_MOCKED_RULE_IRI)],
    });
    const myPolicy = addOptionalRuleForPolicy(
      mockedPolicy,
      mockRule(MOCKED_POLICY_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ANY, OTHER_MOCKED_RULE_IRI)
      )
    ).toBe(true);
  });

  it("does not change the existing required and forbidden rules", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      forbidden: [mockRule(FORBIDDEN_RULE_IRI)],
      required: [mockRule(REQUIRED_RULE_IRI)],
    });
    const myPolicy = addOptionalRuleForPolicy(
      mockedPolicy,
      mockRule(OPTIONAL_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ALL, REQUIRED_RULE_IRI)
      )
    ).toBe(true);
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_NONE, FORBIDDEN_RULE_IRI)
      )
    ).toBe(true);
  });

  it("does not change the input policy", () => {
    const myPolicy = mockPolicy(MOCKED_POLICY_IRI);
    addOptionalRuleForPolicy(myPolicy, mockRule(MOCKED_RULE_IRI));
    expect(myPolicy.size).toEqual(0);
  });
});

describe("addRequiredRuleForPolicy", () => {
  it("adds the rule in the required rules of the policy", () => {
    const myPolicy = addRequiredRuleForPolicy(
      mockPolicy(MOCKED_POLICY_IRI),
      mockRule(MOCKED_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ALL, MOCKED_RULE_IRI)
      )
    ).toBe(true);
  });

  it("does not remove the existing required rules", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      required: [mockRule(OTHER_MOCKED_RULE_IRI)],
    });
    const myPolicy = addRequiredRuleForPolicy(
      mockedPolicy,
      mockRule(MOCKED_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ALL, OTHER_MOCKED_RULE_IRI)
      )
    ).toBe(true);
  });

  it("does not change the existing optional and forbidden rules", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      forbidden: [mockRule(FORBIDDEN_RULE_IRI)],
      optional: [mockRule(OPTIONAL_RULE_IRI)],
    });
    const myPolicy = addRequiredRuleForPolicy(
      mockedPolicy,
      mockRule(OPTIONAL_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ANY, OPTIONAL_RULE_IRI)
      )
    ).toBe(true);
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_NONE, FORBIDDEN_RULE_IRI)
      )
    ).toBe(true);
  });

  it("does not change the input policy", () => {
    const myPolicy = mockPolicy(MOCKED_POLICY_IRI);
    addOptionalRuleForPolicy(myPolicy, mockRule(MOCKED_RULE_IRI));
    expect(myPolicy.size).toEqual(0);
  });
});

describe("setForbiddenRuleForPolicy", () => {
  it("sets the provided rules as the forbidden rules for the policy", () => {
    const myPolicy = setForbiddenRuleForPolicy(
      mockPolicy(MOCKED_POLICY_IRI),
      mockRule(MOCKED_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_NONE, MOCKED_RULE_IRI)
      )
    ).toBe(true);
  });

  it("removes any previous forbidden rules for on the policy", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      forbidden: [mockRule(OTHER_MOCKED_RULE_IRI)],
    });
    const myPolicy = setForbiddenRuleForPolicy(
      mockedPolicy,
      mockRule(MOCKED_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_NONE, OTHER_MOCKED_RULE_IRI)
      )
    ).toBe(false);
  });

  it("does not change the existing optional and required rules on the policy", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      optional: [mockRule(OPTIONAL_RULE_IRI)],
      required: [mockRule(REQUIRED_RULE_IRI)],
    });
    const myPolicy = setForbiddenRuleForPolicy(
      mockedPolicy,
      mockRule(FORBIDDEN_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ALL, REQUIRED_RULE_IRI)
      )
    ).toBe(true);
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ANY, OPTIONAL_RULE_IRI)
      )
    ).toBe(true);
  });

  it("does not change the input policy", () => {
    const myPolicy = mockPolicy(MOCKED_POLICY_IRI);
    setForbiddenRuleForPolicy(myPolicy, mockRule(MOCKED_RULE_IRI));
    expect(myPolicy.size).toEqual(0);
  });
});

describe("setOptionalRuleForPolicy", () => {
  it("sets the provided rules as the optional rules for the policy", () => {
    const myPolicy = setOptionalRuleForPolicy(
      mockPolicy(MOCKED_POLICY_IRI),
      mockRule(MOCKED_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ANY, MOCKED_RULE_IRI)
      )
    ).toBe(true);
  });

  it("removes any previous optional rules for on the policy", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      optional: [mockRule(OTHER_MOCKED_RULE_IRI)],
    });
    const myPolicy = setOptionalRuleForPolicy(
      mockedPolicy,
      mockRule(MOCKED_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ANY, OTHER_MOCKED_RULE_IRI)
      )
    ).toBe(false);
  });

  it("does not change the existing forbidden and required rules on the policy", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      forbidden: [mockRule(FORBIDDEN_RULE_IRI)],
      required: [mockRule(REQUIRED_RULE_IRI)],
    });
    const myPolicy = setOptionalRuleForPolicy(
      mockedPolicy,
      mockRule(OPTIONAL_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ALL, REQUIRED_RULE_IRI)
      )
    ).toBe(true);
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_NONE, FORBIDDEN_RULE_IRI)
      )
    ).toBe(true);
  });

  it("does not change the input policy", () => {
    const myPolicy = mockPolicy(MOCKED_POLICY_IRI);
    setOptionalRuleForPolicy(myPolicy, mockRule(MOCKED_RULE_IRI));
    expect(myPolicy.size).toEqual(0);
  });
});

describe("setRequiredRuleForPolicy", () => {
  it("sets the provided rules as the required rules for the policy", () => {
    const myPolicy = setRequiredRuleForPolicy(
      mockPolicy(MOCKED_POLICY_IRI),
      mockRule(MOCKED_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ALL, MOCKED_RULE_IRI)
      )
    ).toBe(true);
  });

  it("removes any previous required rules for on the policy", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      required: [mockRule(OTHER_MOCKED_RULE_IRI)],
    });
    const myPolicy = setRequiredRuleForPolicy(
      mockedPolicy,
      mockRule(MOCKED_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ALL, OTHER_MOCKED_RULE_IRI)
      )
    ).toBe(false);
  });

  it("does not change the existing forbidden and optional rules on the policy", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      forbidden: [mockRule(FORBIDDEN_RULE_IRI)],
      optional: [mockRule(OPTIONAL_RULE_IRI)],
    });
    const myPolicy = setRequiredRuleForPolicy(
      mockedPolicy,
      mockRule(REQUIRED_RULE_IRI)
    );
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_ANY, OPTIONAL_RULE_IRI)
      )
    ).toBe(true);
    expect(
      myPolicy.has(
        DataFactory.quad(MOCKED_POLICY_IRI, ACP_NONE, FORBIDDEN_RULE_IRI)
      )
    ).toBe(true);
  });

  it("does not change the input policy", () => {
    const myPolicy = mockPolicy(MOCKED_POLICY_IRI);
    setRequiredRuleForPolicy(myPolicy, mockRule(MOCKED_RULE_IRI));
    expect(myPolicy.size).toEqual(0);
  });
});

describe("getForbiddenRuleForPolicyAll", () => {
  it("returns all the forbidden rules for the given policy", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      forbidden: [mockRule(MOCKED_RULE_IRI), mockRule(OTHER_MOCKED_RULE_IRI)],
    });
    const forbiddenRules = getForbiddenRuleForPolicyAll(mockedPolicy);
    expect(forbiddenRules).toContainEqual(MOCKED_RULE_IRI.value);
    expect(forbiddenRules).toContainEqual(OTHER_MOCKED_RULE_IRI.value);
  });

  it("returns only the forbidden rules for the given policy", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      forbidden: [mockRule(FORBIDDEN_RULE_IRI)],
      optional: [mockRule(OPTIONAL_RULE_IRI)],
      required: [mockRule(REQUIRED_RULE_IRI)],
    });
    const forbiddenRules = getForbiddenRuleForPolicyAll(mockedPolicy);
    expect(forbiddenRules).not.toContainEqual(OPTIONAL_RULE_IRI.value);
    expect(forbiddenRules).not.toContainEqual(REQUIRED_RULE_IRI.value);
  });
});

describe("getOptionalRulesOnPolicyAll", () => {
  it("returns all the optional rules for the given policy", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      optional: [mockRule(MOCKED_RULE_IRI), mockRule(OTHER_MOCKED_RULE_IRI)],
    });
    const optionalRules = getOptionalRuleForPolicyAll(mockedPolicy);
    expect(optionalRules).toContainEqual(MOCKED_RULE_IRI.value);
    expect(optionalRules).toContainEqual(OTHER_MOCKED_RULE_IRI.value);
  });

  it("returns only the optional rules for the given policy", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      forbidden: [mockRule(FORBIDDEN_RULE_IRI)],
      optional: [mockRule(OPTIONAL_RULE_IRI)],
      required: [mockRule(REQUIRED_RULE_IRI)],
    });
    const optionalRules = getOptionalRuleForPolicyAll(mockedPolicy);
    expect(optionalRules).not.toContainEqual(FORBIDDEN_RULE_IRI.value);
    expect(optionalRules).not.toContainEqual(REQUIRED_RULE_IRI.value);
  });
});

describe("getRequiredRulesOnPolicyAll", () => {
  it("returns all the required rules for the given policy", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      required: [mockRule(MOCKED_RULE_IRI), mockRule(OTHER_MOCKED_RULE_IRI)],
    });
    const requiredRules = getRequiredRuleForPolicyAll(mockedPolicy);
    expect(requiredRules).toContainEqual(MOCKED_RULE_IRI.value);
    expect(requiredRules).toContainEqual(OTHER_MOCKED_RULE_IRI.value);
  });

  it("returns only the required rules for the given policy", () => {
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      forbidden: [mockRule(FORBIDDEN_RULE_IRI)],
      optional: [mockRule(OPTIONAL_RULE_IRI)],
      required: [mockRule(REQUIRED_RULE_IRI)],
    });
    const requiredRules = getRequiredRuleForPolicyAll(mockedPolicy);
    expect(requiredRules).not.toContainEqual(FORBIDDEN_RULE_IRI.value);
    expect(requiredRules).not.toContainEqual(OPTIONAL_RULE_IRI.value);
  });
});

describe("removeRequiredRuleForPolicy", () => {
  it("removes the rule from the rules required by the given policy", () => {
    const mockedRule = mockRule(MOCKED_RULE_IRI);
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      required: [mockedRule],
    });
    const result = removeRequiredRuleForPolicy(mockedPolicy, mockedRule);
    expect(
      result.has(DataFactory.quad(MOCKED_POLICY_IRI, ACP_ALL, MOCKED_RULE_IRI))
    ).toEqual(false);
  });

  it("does not remove the rule from the rules optional/forbidden by the given policy", () => {
    const mockedRule = mockRule(MOCKED_RULE_IRI);
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      optional: [mockedRule],
      forbidden: [mockedRule],
    });
    const result = removeRequiredRuleForPolicy(mockedPolicy, mockedRule);
    expect(
      result.has(DataFactory.quad(MOCKED_POLICY_IRI, ACP_ANY, MOCKED_RULE_IRI))
    ).toEqual(true);
    expect(
      result.has(DataFactory.quad(MOCKED_POLICY_IRI, ACP_NONE, MOCKED_RULE_IRI))
    ).toEqual(true);
  });
});

describe("removeOptionalRuleForPolicy", () => {
  it("removes the rule from the rules required by the given policy", () => {
    const mockedRule = mockRule(MOCKED_RULE_IRI);
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      optional: [mockedRule],
    });
    const result = removeOptionalRuleForPolicy(mockedPolicy, mockedRule);
    expect(
      result.has(DataFactory.quad(MOCKED_POLICY_IRI, ACP_ANY, MOCKED_RULE_IRI))
    ).toEqual(false);
  });

  it("does not remove the rule from the rules required/forbidden by the given policy", () => {
    const mockedRule = mockRule(MOCKED_RULE_IRI);
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      required: [mockedRule],
      forbidden: [mockedRule],
    });
    const result = removeOptionalRuleForPolicy(mockedPolicy, mockedRule);
    expect(
      result.has(DataFactory.quad(MOCKED_POLICY_IRI, ACP_ALL, MOCKED_RULE_IRI))
    ).toEqual(true);
    expect(
      result.has(DataFactory.quad(MOCKED_POLICY_IRI, ACP_NONE, MOCKED_RULE_IRI))
    ).toEqual(true);
  });
});

describe("removeForbiddenRuleForPolicy", () => {
  it("removes the rule from the rules forbidden by the given policy", () => {
    const mockedRule = mockRule(MOCKED_RULE_IRI);
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      forbidden: [mockedRule],
    });
    const result = removeForbiddenRuleForPolicy(mockedPolicy, mockedRule);
    expect(
      result.has(DataFactory.quad(MOCKED_POLICY_IRI, ACP_NONE, MOCKED_RULE_IRI))
    ).toEqual(false);
  });

  it("does not remove the rule from the rules required/optional by the given policy", () => {
    const mockedRule = mockRule(MOCKED_RULE_IRI);
    const mockedPolicy = mockPolicy(MOCKED_POLICY_IRI, {
      required: [mockedRule],
      optional: [mockedRule],
    });
    const result = removeForbiddenRuleForPolicy(mockedPolicy, mockedRule);
    expect(
      result.has(DataFactory.quad(MOCKED_POLICY_IRI, ACP_ALL, MOCKED_RULE_IRI))
    ).toEqual(true);
    expect(
      result.has(DataFactory.quad(MOCKED_POLICY_IRI, ACP_ANY, MOCKED_RULE_IRI))
    ).toEqual(true);
  });
});

describe("createRule", () => {
  it("returns a acp:Rule", () => {
    const myRule = createRule(MOCKED_RULE_IRI.value);
    expect(
      myRule.has(DataFactory.quad(MOCKED_RULE_IRI, RDF_TYPE, ACP_RULE))
    ).toBe(true);
  });
  it("returns an **empty** rule", () => {
    const myRule = createRule("https://my.pod/rule-resource#rule");
    // The rule should only contain a type triple.
    expect(myRule.size).toEqual(1);
  });
});

describe("getRule", () => {
  it("returns the rule with a matching IRI", () => {
    const rule = mockRule(MOCKED_RULE_IRI);
    const dataset = setThing(createSolidDataset(), rule);
    const result = getRule(dataset, MOCKED_RULE_IRI.value);
    expect(result).not.toBeNull();
  });

  it("does not return a Thing with a matching IRI but the wrong type", () => {
    const notARule = createThing({
      url: "https://my.pod/rule-resource#not-a-rule",
    });
    const dataset = setThing(
      createSolidDataset(),
      setUrl(notARule, RDF_TYPE, "http://example.org/ns#NotRuleType")
    );
    const result = getRule(dataset, "https://my.pod/rule-resource#not-a-rule");
    expect(result).toBeNull();
  });

  it("does not return a rule with a mismatching IRI", () => {
    const rule = mockRule(MOCKED_RULE_IRI);
    const dataset = setThing(createSolidDataset(), rule);
    const result = getRule(dataset, OTHER_MOCKED_RULE_IRI);
    expect(result).toBeNull();
  });
});

describe("getAgentForRuleAll", () => {
  it("returns all the agents a rule applies to by webid", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      agents: [MOCK_WEBID_ME, MOCK_WEBID_YOU],
    });
    const agents = getAgentForRuleAll(rule);
    expect(agents).toContainEqual(MOCK_WEBID_ME.value);
    expect(agents).toContainEqual(MOCK_WEBID_YOU.value);
  });

  it("does not return the groups/public/authenticated a rule applies to", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      groups: [MOCK_GROUP_IRI],
      public: true,
      authenticated: true,
    });
    const agents = getAgentForRuleAll(rule);
    expect(agents).not.toContainEqual(MOCK_GROUP_IRI.value);
    expect(agents).not.toContainEqual(ACP_AUTHENTICATED);
    expect(agents).not.toContainEqual(ACP_PUBLIC);
  });
});

describe("setAgentForRule", () => {
  it("sets the given agents for the rule", () => {
    const rule = mockRule(MOCKED_RULE_IRI);
    const result = setAgentForRule(rule, MOCK_WEBID_ME.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_ME))
    ).toBe(true);
  });

  it("deletes any agents previously set for the rule", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      agents: [MOCK_WEBID_YOU],
    });
    const result = setAgentForRule(rule, MOCK_WEBID_ME.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_ME))
    ).toBe(true);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_YOU))
    ).toBe(false);
  });

  it("does not change the input rule", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      agents: [MOCK_WEBID_YOU],
    });
    setAgentForRule(rule, MOCK_WEBID_ME.value);
    expect(
      rule.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_ME))
    ).toBe(false);
    expect(
      rule.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_YOU))
    ).toBe(true);
  });

  it("does not overwrite public and authenticated agents", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      public: true,
      authenticated: true,
    });
    const result = setAgentForRule(rule, MOCK_WEBID_YOU.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_PUBLIC))
    ).toBe(true);

    expect(
      result.has(
        DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_AUTHENTICATED)
      )
    ).toBe(true);
  });
});

describe("addAgentForRule", () => {
  it("adds the given agent to the rule", () => {
    const rule = mockRule(MOCKED_RULE_IRI);
    const result = addAgentForRule(rule, MOCK_WEBID_YOU.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_YOU))
    ).toBe(true);
  });

  it("does not override existing agents/public/authenticated/groups", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      agents: [MOCK_WEBID_ME],
      groups: [MOCK_GROUP_IRI],
      public: true,
      authenticated: true,
    });
    const result = addAgentForRule(rule, MOCK_WEBID_YOU.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_YOU))
    ).toBe(true);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_ME))
    ).toBe(true);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_PUBLIC))
    ).toBe(true);
    expect(
      result.has(
        DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_AUTHENTICATED)
      )
    ).toBe(true);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_GROUP, MOCK_GROUP_IRI))
    ).toBe(true);
  });
});

describe("removeAgentForRule", () => {
  it("removes the given agent from the rule", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      agents: [MOCK_WEBID_YOU],
    });
    const result = removeAgentForRule(rule, MOCK_WEBID_YOU.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_YOU))
    ).toBe(false);
  });

  it("does not delete unrelated agents", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      agents: [MOCK_WEBID_ME, MOCK_WEBID_YOU],
      public: true,
      authenticated: true,
    });
    const result = removeAgentForRule(rule, MOCK_WEBID_YOU.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_YOU))
    ).toBe(false);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_ME))
    ).toBe(true);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_PUBLIC))
    ).toBe(true);
    expect(
      result.has(
        DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_AUTHENTICATED)
      )
    ).toBe(true);
  });

  it("does not remove groups, even with matching IRI", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      groups: [MOCK_GROUP_IRI],
    });
    const result = removeAgentForRule(rule, MOCK_GROUP_IRI.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_GROUP, MOCK_GROUP_IRI))
    ).toBe(true);
  });
});

describe("getGroupForRuleAll", () => {
  it("returns all the groups a rule applies to", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      groups: [MOCK_GROUP_IRI, MOCK_GROUP_OTHER_IRI],
    });
    const groups = getGroupForRuleAll(rule);
    expect(groups).toContainEqual(MOCK_GROUP_IRI.value);
    expect(groups).toContainEqual(MOCK_GROUP_OTHER_IRI.value);
  });

  it("does not return the agents/public/authenticated a rule applies to", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      agents: [MOCK_WEBID_ME],
      public: true,
      authenticated: true,
    });
    const groups = getGroupForRuleAll(rule);
    expect(groups).not.toContainEqual(MOCK_WEBID_ME.value);
    expect(groups).not.toContainEqual(ACP_AUTHENTICATED.value);
    expect(groups).not.toContainEqual(ACP_PUBLIC.value);
  });
});

describe("setGroupForRule", () => {
  it("sets the given groups for the rule", () => {
    const rule = mockRule(MOCKED_RULE_IRI);
    const result = setGroupForRule(rule, MOCK_GROUP_IRI.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_GROUP, MOCK_GROUP_IRI))
    ).toBe(true);
  });

  it("deletes any groups previously set for the rule", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      groups: [MOCK_GROUP_OTHER_IRI],
    });
    const result = setGroupForRule(rule, MOCK_GROUP_IRI.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_GROUP, MOCK_GROUP_IRI))
    ).toBe(true);
    expect(
      result.has(
        DataFactory.quad(MOCKED_RULE_IRI, ACP_GROUP, MOCK_GROUP_OTHER_IRI)
      )
    ).toBe(false);
  });

  it("does not change the input rule", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      groups: [MOCK_GROUP_OTHER_IRI],
    });
    setGroupForRule(rule, MOCK_GROUP_IRI.value);
    expect(
      rule.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_GROUP, MOCK_GROUP_IRI))
    ).toBe(false);
    expect(
      rule.has(
        DataFactory.quad(MOCKED_RULE_IRI, ACP_GROUP, MOCK_GROUP_OTHER_IRI)
      )
    ).toBe(true);
  });
});

describe("addGroupForRule", () => {
  it("adds the given group to the rule", () => {
    const rule = mockRule(MOCKED_RULE_IRI);
    const result = addGroupForRule(rule, "https://your.pod/groups#a-group");
    expect(
      result.has(
        DataFactory.quad(
          MOCKED_RULE_IRI,
          ACP_GROUP,
          DataFactory.namedNode("https://your.pod/groups#a-group")
        )
      )
    ).toBe(true);
  });

  it("does not override existing agents/public/authenticated/groups", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      agents: [MOCK_WEBID_ME],
      groups: [MOCK_GROUP_IRI],
      public: true,
      authenticated: true,
    });
    const result = addGroupForRule(rule, MOCK_GROUP_OTHER_IRI.value);
    expect(
      result.has(
        DataFactory.quad(MOCKED_RULE_IRI, ACP_GROUP, MOCK_GROUP_OTHER_IRI)
      )
    ).toBe(true);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_ME))
    ).toBe(true);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_PUBLIC))
    ).toBe(true);
    expect(
      result.has(
        DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_AUTHENTICATED)
      )
    ).toBe(true);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_GROUP, MOCK_GROUP_IRI))
    ).toBe(true);
  });
});

describe("removeGroupForRule", () => {
  it("removes the given group from the rule", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      groups: [MOCK_GROUP_IRI],
    });
    const result = removeGroupForRule(rule, MOCK_GROUP_IRI.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_GROUP, MOCK_GROUP_IRI))
    ).toBe(false);
  });

  it("does not delete unrelated groups", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      groups: [MOCK_GROUP_IRI, MOCK_GROUP_OTHER_IRI],
    });
    const result = removeGroupForRule(rule, MOCK_GROUP_IRI.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_GROUP, MOCK_GROUP_IRI))
    ).toBe(false);
    expect(
      result.has(
        DataFactory.quad(MOCKED_RULE_IRI, ACP_GROUP, MOCK_GROUP_OTHER_IRI)
      )
    ).toBe(true);
  });

  it("does not remove agents, even with matching IRI", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      agents: [MOCK_WEBID_ME],
    });
    const result = removeGroupForRule(rule, MOCK_WEBID_ME.value);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_ME))
    ).toBe(true);
  });
});

describe("hasPublicForRule", () => {
  it("returns true if the rule applies to the public agent", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      public: true,
    });
    expect(hasPublicForRule(rule)).toEqual(true);
  });
  it("returns false if the rule only applies to other agent", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      public: false,
      authenticated: true,
      agents: [MOCK_WEBID_ME],
    });
    expect(hasPublicForRule(rule)).toEqual(false);
  });
});

describe("setPublicForRule", () => {
  it("applies to given rule to the public agent", () => {
    const rule = mockRule(MOCKED_RULE_IRI);
    const result = setPublicForRule(rule, true);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_PUBLIC))
    ).toBe(true);
  });

  it("prevents the rule from applying to the public agent", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      public: true,
    });
    const result = setPublicForRule(rule, false);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_PUBLIC))
    ).toBe(false);
  });

  it("does not change the input rule", () => {
    const rule = mockRule(MOCKED_RULE_IRI);
    setPublicForRule(rule, true);
    expect(
      rule.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_PUBLIC))
    ).toBe(false);
  });

  it("does not change the other agents", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      authenticated: true,
      agents: [MOCK_WEBID_ME],
    });
    const result = setPublicForRule(rule, true);
    expect(
      result.has(
        DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_AUTHENTICATED)
      )
    ).toBe(true);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_ME))
    ).toBe(true);
  });
});

describe("hasAuthenticatedForRule", () => {
  it("returns true if the rule applies to authenticated agents", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      authenticated: true,
    });
    expect(hasAuthenticatedForRule(rule)).toEqual(true);
  });
  it("returns false if the rule only applies to other agent", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      public: true,
      authenticated: false,
      agents: [MOCK_WEBID_ME],
    });
    expect(hasAuthenticatedForRule(rule)).toEqual(false);
  });
});

describe("setAuthenticatedForRule", () => {
  it("applies to given rule to authenticated agents", () => {
    const rule = mockRule(MOCKED_RULE_IRI);
    const result = setAuthenticatedForRule(rule, true);
    expect(
      result.has(
        DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_AUTHENTICATED)
      )
    ).toBe(true);
  });

  it("prevents the rule from applying to authenticated agents", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      authenticated: true,
    });
    const result = setAuthenticatedForRule(rule, false);
    expect(
      result.has(
        DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_AUTHENTICATED)
      )
    ).toBe(false);
  });

  it("does not change the input rule", () => {
    const rule = mockRule(MOCKED_RULE_IRI);
    setPublicForRule(rule, true);
    expect(
      rule.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_AUTHENTICATED))
    ).toBe(false);
  });

  it("does not change the other agents", () => {
    const rule = mockRule(MOCKED_RULE_IRI, {
      public: true,
      agents: [MOCK_WEBID_ME],
    });
    const result = setPublicForRule(rule, true);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, ACP_PUBLIC))
    ).toBe(true);
    expect(
      result.has(DataFactory.quad(MOCKED_RULE_IRI, ACP_AGENT, MOCK_WEBID_ME))
    ).toBe(true);
  });
});