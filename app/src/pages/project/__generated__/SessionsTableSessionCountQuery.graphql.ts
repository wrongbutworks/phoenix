/**
 * @generated SignedSource<<4c6bfdf6569c3956242f8178350fd2fc>>
 * @lightSyntaxTransform
 * @nogrep
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from 'relay-runtime';
export type TimeRange = {
  end?: string | null;
  start?: string | null;
};
export type SessionsTableSessionCountQuery$variables = {
  filterIoSubstring?: string | null;
  id: string;
  sessionFilterCondition?: string | null;
  sessionId?: string | null;
  timeRange: TimeRange;
};
export type SessionsTableSessionCountQuery$data = {
  readonly project: {
    readonly sessionCount?: number;
  };
};
export type SessionsTableSessionCountQuery = {
  response: SessionsTableSessionCountQuery$data;
  variables: SessionsTableSessionCountQuery$variables;
};

const node: ConcreteRequest = (function(){
var v0 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "filterIoSubstring"
},
v1 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "id"
},
v2 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "sessionFilterCondition"
},
v3 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "sessionId"
},
v4 = {
  "defaultValue": null,
  "kind": "LocalArgument",
  "name": "timeRange"
},
v5 = [
  {
    "kind": "Variable",
    "name": "id",
    "variableName": "id"
  }
],
v6 = {
  "kind": "InlineFragment",
  "selections": [
    {
      "alias": null,
      "args": [
        {
          "kind": "Variable",
          "name": "filterIoSubstring",
          "variableName": "filterIoSubstring"
        },
        {
          "kind": "Variable",
          "name": "sessionFilterCondition",
          "variableName": "sessionFilterCondition"
        },
        {
          "kind": "Variable",
          "name": "sessionId",
          "variableName": "sessionId"
        },
        {
          "kind": "Variable",
          "name": "timeRange",
          "variableName": "timeRange"
        }
      ],
      "kind": "ScalarField",
      "name": "sessionCount",
      "storageKey": null
    }
  ],
  "type": "Project",
  "abstractKey": null
};
return {
  "fragment": {
    "argumentDefinitions": [
      (v0/*: any*/),
      (v1/*: any*/),
      (v2/*: any*/),
      (v3/*: any*/),
      (v4/*: any*/)
    ],
    "kind": "Fragment",
    "metadata": null,
    "name": "SessionsTableSessionCountQuery",
    "selections": [
      {
        "alias": "project",
        "args": (v5/*: any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "node",
        "plural": false,
        "selections": [
          (v6/*: any*/)
        ],
        "storageKey": null
      }
    ],
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": [
      (v1/*: any*/),
      (v4/*: any*/),
      (v0/*: any*/),
      (v2/*: any*/),
      (v3/*: any*/)
    ],
    "kind": "Operation",
    "name": "SessionsTableSessionCountQuery",
    "selections": [
      {
        "alias": "project",
        "args": (v5/*: any*/),
        "concreteType": null,
        "kind": "LinkedField",
        "name": "node",
        "plural": false,
        "selections": [
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "__typename",
            "storageKey": null
          },
          (v6/*: any*/),
          {
            "alias": null,
            "args": null,
            "kind": "ScalarField",
            "name": "id",
            "storageKey": null
          }
        ],
        "storageKey": null
      }
    ]
  },
  "params": {
    "cacheID": "effd355e41e16d9d6a20b7d5220b2770",
    "id": null,
    "metadata": {},
    "name": "SessionsTableSessionCountQuery",
    "operationKind": "query",
    "text": "query SessionsTableSessionCountQuery(\n  $id: ID!\n  $timeRange: TimeRange!\n  $filterIoSubstring: String\n  $sessionFilterCondition: String\n  $sessionId: String\n) {\n  project: node(id: $id) {\n    __typename\n    ... on Project {\n      sessionCount(timeRange: $timeRange, filterIoSubstring: $filterIoSubstring, sessionFilterCondition: $sessionFilterCondition, sessionId: $sessionId)\n    }\n    id\n  }\n}\n"
  }
};
})();

(node as any).hash = "154bb10c40251b9e32a41937fb9d2bf3";

export default node;
