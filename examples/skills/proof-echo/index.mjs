export function echo(input, context) {
  return {
    text: input.text,
    skillName: context.skillName,
    skillVersion: context.skillVersion,
    bundleDigest: context.bundleDigest,
    activeSetDigest: context.activeSetDigest,
  };
}
