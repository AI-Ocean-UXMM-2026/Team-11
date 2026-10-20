# SupplyLink baseline

Current specialization: one STT Everyday sneaker model, six size/color stock variants.
Separate SME and Driver sign-in pages retain the forest palette, Manrope typography and quiet
form controls. A single shoe illustration gives the supplier a clear identity; no grocery assets remain.

Audience: Yangon supplier headquarters, independent shops, branch staff and drivers.
Primary job: identify the next operational action and follow an order across the network.

## References and direction

- Supplier concept and four portal structure: https://supplier-flow-sketch.politetitan65.chatgpt.site
- Upwork spacing, restrained borders, green navigation/actions and task hierarchy: https://mobbin.com/screens/fee4b13d-aa45-4f06-bb25-b9a2a874b0d5
- Upwork contextual rail and green feature area: https://mobbin.com/screens/7b4e8da7-82db-4420-aaae-834d441c3331
- Product rules: PRD_Driver_Registration_and_Live_Tracking.md v2.2 supersedes README and older prototype wording.

## Tokens

Forest #17493D for the network panel; action green #217346; canvas #FAFBF8;
pale mint #EAF2E7; amber #B36B13; ink #20332B; border #E5EAE3.
Manrope throughout, medium weights for controls, bold for headings, tabular figures for amounts.
12px panel radius, 7px controls, pill status labels. Quiet borders without card shadows.

## Layout

Left aligned workspace. A fixed 224px navigation rail and a slim utility bar frame the
content. Page title and actions precede one characteristic illustrated network panel.
Four compact figures lead into a wide operational table and a narrower branch/action rail.
On tablets the navigation becomes compact; on phones it opens from a named menu button.

```
navigation | context / search / account
           | title                       actions
           | connected network / illustration
           | metrics metrics metrics metrics
           | recent orders         | branch health
           |                       | attention
```

## Review against brief

The skill search proposed a blue/orange marketing page and code-oriented typography.
The separate product search found no supplier dashboard match after one narrower retry;
general interaction guidance is taken from the skill's built-in priorities.
Those choices conflict with the supplied operational references, so this implementation
uses their forest/green direction and a task-first dashboard instead. The generic marketing
hero is replaced with a compact, supplier-specific network illustration. Avoid fabricated
GPS routes, AI forecasts and growth comparisons. Demonstration records are always labelled.

## Baseline boundary

Demo mode supports interactive local previews. Live mode uses Supabase Auth, a server-assigned
role and RLS. The role selector exists only in demo mode. Tables, migrations and account
provisioning establish the backend frame; full payment evidence, transactional stock,
credential reset/revocation, GPS and complete reporting remain subsequent implementation.
