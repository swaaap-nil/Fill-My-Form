# `tools/` — the only way the agent touches the world

The model receives a name and a JSON schema. It never receives a JavaScript
evaluator, a DOM handle or a network client.

```
model -> schema validation -> policy -> execute -> result validation -> agent
```

`executeTool` in `registry.ts` implements the middle of that pipeline. Note
that results are validated too: a misbehaving adapter must not be able to widen
what the agent believes it received.

## Progressive disclosure

`ToolRegistry.describe(domains)` is the only way tools reach a prompt, and it
takes the domains relevant to the *current phase*. There is deliberately no
"list everything" for prompt construction.

| Phase | Domains exposed |
|---|---|
| Form inspection | `browser` |
| Memory retrieval | `memory` |
| Filling | `browser` |
| Upload | `files`, `browser` |
| Confirmation | `user` |

Upload tools are invisible when the form has no file field. Destructive tools
are not registered at all until there is a reason.

## Adding a tool

```ts
registry.register({
  name: "inspect_field_context",
  domain: CapabilityDomain.BROWSER,
  description: "Return labels and nearby text for one field.",
  input: z.object({ fieldId: z.string() }),
  output: z.object({ label: z.string().optional(), nearbyText: z.array(z.string()) }),
  risk: ActionRisk.LOW,
  execute: async ({ fieldId }, ctx) => adapter.describeField(fieldId, ctx.signal),
});
```

Nothing in the agent loop changes. Capabilities a tool needs — a page adapter,
a memory store — are captured in its closure at registration, so the grant is
visible at the wiring site rather than assumed at call time.
