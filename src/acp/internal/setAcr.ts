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

import { internal_cloneResource } from "../../resource/resource.internal";
import type { WithAccessibleAcr } from "../acp";
import type { AccessControlResource } from "../type/AccessControlResource";

/**
 * @hidden
 *
 * Internal function that attaches an ACR to a Resource. Prefer using this than
 * setting the internal values manually (easier to refactor when changing the internals).
 */
export function setAcr<T extends WithAccessibleAcr>(
  resource: T,
  acr: AccessControlResource,
): T {
  return Object.assign(internal_cloneResource(resource), {
    internal_acp: {
      acr,
    },
  });
}
