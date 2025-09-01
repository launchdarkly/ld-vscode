export const exampleFlag = `
The feature flag with the key "chatbox" is named "Enable: Chatbox" and is designed to enable a chatbox for clients. It was last modified 01/01/2024 at 10:31AM UTC. 

Flag Availability:
- JavaScript Client: \`true\`
- Mobile: \`false\`

Variations: 
- "Enable Chatbox" is \`true\` 
- "Disable Chatbox" is \`false\`

Targeting:

- The flag is targeted at a specific user with the key "testuser".
- There are three rules associated with this flag for targeting:
  - The first rule targets users who belong to the "qa-team" segment and returns \`true\`.
  - The second rule targets users with the key "98954321" and returns \`true\`.
  - The third rule targets users with the email "test@example.com" and returns \`false\`.

Fallthrough:
- The flag has a fallthrough variation value of \`false\`

Off Variation:
- an off variation value  \`false\`, indicating that if none of the rules match, the flag will default to the off variation.
`;
