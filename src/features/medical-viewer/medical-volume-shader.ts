/** Viro moves only declaration lines outside main(), so sampling is generated inline.
 * The WebGL proof uses exactly the same modifier body and native declaration splitter. */
export function volumeSampleGLSL(name: string, point: string) {
  return `
highp vec3 ${name}P = clamp(${point}, vec3(0.0), vec3(1.0)) * (u_dimensions - 1.0);
highp float ${name}Z = floor(${name}P.z);
highp vec2 ${name}XY = ${name}P.xy + vec2(1.5);
highp vec2 ${name}UV0 = (vec2(mod(${name}Z, u_atlas.z), floor(${name}Z / u_atlas.z)) * u_tile.xy + ${name}XY) / u_atlas.xy;
highp float ${name}NextZ = min(${name}Z + 1.0, u_dimensions.z - 1.0);
highp vec2 ${name}UV1 = (vec2(mod(${name}NextZ, u_atlas.z), floor(${name}NextZ / u_atlas.z)) * u_tile.xy + ${name}XY) / u_atlas.xy;
${name}UV0.y = mix(${name}UV0.y, 1.0 - ${name}UV0.y, u_flip_y);
${name}UV1.y = mix(${name}UV1.y, 1.0 - ${name}UV1.y, u_flip_y);
// Promote the samples before arithmetic; a highp destination alone does not promote lowp operations.
highp float ${name}High0 = texture(u_high, ${name}UV0).a;
highp float ${name}Low0 = texture(u_low, ${name}UV0).a;
highp float ${name}High1 = texture(u_high, ${name}UV1).a;
highp float ${name}Low1 = texture(u_low, ${name}UV1).a;
highp float ${name}Code0 = ${name}High0 * 65280.0 + ${name}Low0 * 255.0;
highp float ${name}Code1 = ${name}High1 * 65280.0 + ${name}Low1 * 255.0;
highp float ${name}Valid = mix(texture(u_validity, ${name}UV0).a, texture(u_validity, ${name}UV1).a, fract(${name}P.z));
highp float ${name}Value = u_scalar.x + u_scalar.y * mix(${name}Code0, ${name}Code1, fract(${name}P.z)) / max(${name}Valid, 0.00001);
`;
}
export const VOLUME_SHADER_UNIFORMS = `
uniform highp mat4 model_matrix;
uniform highp sampler2D u_high;
uniform highp sampler2D u_low;
uniform highp sampler2D u_validity;
uniform highp vec3 u_dimensions;
uniform highp vec4 u_atlas;
uniform highp vec4 u_tile;
uniform highp vec4 u_scalar;
uniform highp vec4 u_appearance;
uniform highp vec3 u_extent;
uniform highp vec3 u_crop_min;
uniform highp vec3 u_crop_max;
uniform highp float u_samples;
uniform highp float u_flip_y;
`;
export const VOLUME_SHADER_BODY = `
highp mat4 medicalInverse = inverse(model_matrix);
highp vec3 medicalOriginLocal = (medicalInverse * vec4(camera_position, 1.0)).xyz;
highp vec3 medicalPointLocal = (medicalInverse * vec4(_surface.position, 1.0)).xyz;
// Local XYZ=(R,S,-A); ray distance is measured in physical millimetres.
highp vec3 medicalOrigin = vec3(medicalOriginLocal.x, -medicalOriginLocal.z, medicalOriginLocal.y) / u_extent + 0.5;
highp vec3 medicalDirection = normalize(vec3(medicalPointLocal.x - medicalOriginLocal.x, medicalOriginLocal.z - medicalPointLocal.z, medicalPointLocal.y - medicalOriginLocal.y));
highp vec3 medicalSpanMm = (u_dimensions - 1.0) * u_scalar.w;
highp vec3 medicalRay = medicalDirection / medicalSpanMm;
highp vec3 medicalSafeRay = sign(medicalRay + vec3(0.00000001)) * max(abs(medicalRay), vec3(0.00000001));
highp vec3 medicalNear = min((u_crop_min - medicalOrigin) / medicalSafeRay, (u_crop_max - medicalOrigin) / medicalSafeRay);
highp vec3 medicalFar = max((u_crop_min - medicalOrigin) / medicalSafeRay, (u_crop_max - medicalOrigin) / medicalSafeRay);
highp float medicalEntry = max(0.0, max(medicalNear.x, max(medicalNear.y, medicalNear.z)));
highp float medicalExit = min(medicalFar.x, min(medicalFar.y, medicalFar.z));
highp vec4 medicalColor = vec4(0.0);
if (medicalExit > medicalEntry) {
  highp float medicalStep = (medicalExit - medicalEntry) / u_samples;
  highp vec3 medicalEntryPoint = medicalOrigin + medicalRay * medicalEntry;
  highp vec3 medicalBoundary = min(abs(medicalEntryPoint - u_crop_min), abs(medicalEntryPoint - u_crop_max));
  bool medicalCap = (medicalBoundary.x < 0.0001 && (medicalEntryPoint.x > 0.0001 && medicalEntryPoint.x < 0.9999)) ||
    (medicalBoundary.y < 0.0001 && (medicalEntryPoint.y > 0.0001 && medicalEntryPoint.y < 0.9999)) ||
    (medicalBoundary.z < 0.0001 && (medicalEntryPoint.z > 0.0001 && medicalEntryPoint.z < 0.9999));
  for (int medicalIndex = 0; medicalIndex < 192; medicalIndex++) {
    if (float(medicalIndex) >= u_samples || medicalColor.a > 0.985) break;
    highp float medicalOffset = medicalIndex == 0 && medicalCap ? 0.0 : (float(medicalIndex) + 0.5) * medicalStep;
    highp vec3 medicalPosition = medicalOrigin + medicalRay * (medicalEntry + medicalOffset);
    ${volumeSampleGLSL('medical', 'medicalPosition')}
    highp float medicalIntensity = clamp((medicalValue - u_appearance.y) / u_appearance.x + 0.5, 0.0, 1.0);
    // Bone suppresses low-density tissue; MRI and soft tissue use the same grayscale ramp.
    highp float medicalThreshold = u_appearance.w > 0.5 ? 0.40 : 0.10;
    highp float medicalDensity = smoothstep(medicalThreshold, 1.0, medicalIntensity) * 0.65 * medicalValid;
    highp float medicalAlpha = 1.0 - pow(max(0.00001, 1.0 - medicalDensity), medicalStep * u_appearance.z);
    highp float medicalLighting = 1.0;
    if (medicalIndex == 0 && medicalCap && medicalDensity > 0.001) {
      // An internal crop face presents windowed grayscale detail, like a physical cut section.
      medicalAlpha = (1.0 - exp(-4.0 * u_appearance.z)) * medicalValid;
    } else if (medicalAlpha > 0.01 && medicalColor.a < 0.05) {
      ${volumeSampleGLSL('gradR', 'medicalPosition + vec3(1.0 / (u_dimensions.x - 1.0), 0.0, 0.0)')}
      ${volumeSampleGLSL('gradA', 'medicalPosition + vec3(0.0, 1.0 / (u_dimensions.y - 1.0), 0.0)')}
      ${volumeSampleGLSL('gradS', 'medicalPosition + vec3(0.0, 0.0, 1.0 / (u_dimensions.z - 1.0))')}
      highp vec3 medicalGradient = vec3(gradRValue - medicalValue, gradAValue - medicalValue, gradSValue - medicalValue);
      medicalLighting = 0.35 + 0.65 * abs(dot(normalize(medicalGradient + vec3(0.00001)), medicalDirection));
    }
    highp vec3 medicalRGB = vec3(medicalIntensity * medicalLighting);
    medicalColor.rgb += (1.0 - medicalColor.a) * medicalAlpha * medicalRGB;
    medicalColor.a += (1.0 - medicalColor.a) * medicalAlpha;
  }
}
// Viro's Alpha blend expects straight RGB; compositing above accumulates premultiplied RGB.
_surface.diffuse_color = vec4(medicalColor.rgb / max(medicalColor.a, 0.00001), medicalColor.a);
`;
