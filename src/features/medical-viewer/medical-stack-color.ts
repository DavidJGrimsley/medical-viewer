/** iOS uploads premultiplied sRGB pixels, but Viro's Alpha blend expects straight RGB.
 * Undo premultiplication in encoded sRGB, then return to linear RGB for blending.
 * Uses the ordinary diffuse texture pipeline: no custom samplers or uniforms.
 */
export const STACK_IOS_COLOR_FRAGMENT = `
highp float stackAlpha = _surface.diffuse_color.a;
highp vec3 stackLinear = max(_output_color.rgb, vec3(0.0));
highp vec3 stackEncoded = mix(12.92 * stackLinear, 1.055 * pow(stackLinear, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), stackLinear));
highp vec3 stackStraight = clamp(stackEncoded / max(stackAlpha, 1.0 / 255.0), 0.0, 1.0);
_output_color.rgb = mix(stackStraight / 12.92, pow((stackStraight + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), stackStraight));
`;
