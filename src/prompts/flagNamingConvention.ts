export const flagNamingConventions = `
Flag names should read as an instructional sentence that begins with an action and concludes with a subject.

The action describes purpose and behavior of the flag. This should be a single verb and an optional category, followed by a colon. Some example actions are "Release:" and "Release Mobile:".

The subject describes the target and scope of the flag. Some example subjects are "Widget" and "Homepage banner color."

You should be able to read the name as a sentence that describes the purpose and scope of a flag. For example:

"Rollout: a new feature"
"Configure: a setting"
"Allow: an action"
"Enable: an entitlement"
"Show: an offer"
The exception to this is flags that are a proxy for the state of an external system or process. For these flags, you may not need an action in the flag name.`;
