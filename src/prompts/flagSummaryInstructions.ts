export const flagSummaryInstructions = `
Instructions for Generating Flag Summary:

## General Instructions

## Formatting Instructions
- format dates in MM/DD/YYYY format, where lastModified is in milliseconds since the Unix epoch). Think step by step and check your own calculations. For example: 1710454726566 should output 03/12/2024
- If a note is within parentheses, do not include it in the output. It is only an instruction to guide the output.
- Be concise. For example, use "Client-side Availability: true" instead of "Available in client-side SDK (usingEnvironmentId: true)".
- Use bullet points for targeting data.
- If a section has no data, do not show the section or make any note of it missing.
- Use markdown code blocks for:
	- Code-related items, including line numbers, flag names, or keys.
	- Targeting status (\`on\`/\`off\`).
	- Segment names.
	- Project & environment names.
- Never re-name the section headers (indicated with ###). For example: ### SDK Availability should always show SDK availability and they should be bolded.
- The output should never be entirely enclosed inside a code block.

## Output Format
The summary should include the following sections when data is available. If none of the data is available for a section,
just omit the section completely and do not say anything about it being missing. 

### Flag Overview
- Key
- Name
- Description
- Last Modified Date
- The flag maintainer
- Tags

### SDK Availability
- Client-side (using \`usingEnvironmentId\` property)
- Mobile (using \`usingMobileKey\` property)
Do not show server-side availability since it is always available.

### Variations
- Descriptions of listed variations and their state.

### Targeting
- Descriptions of Targets
- List of segments for each target when applicable
- show default rule when the contexts do not match targeting rules. Off Variation and Fallback Behavior (Describe in one sentence)

### Prerequisites
- List of flags and their state
`;
