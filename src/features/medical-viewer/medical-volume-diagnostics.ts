import type { VolumeDebugMode } from './medical-volumes.ts';
import { VOLUME_SHADER_BODY, VOLUME_SHADER_UNIFORMS } from './medical-volume-shader.ts';

export interface VolumeTexelProbe {
  ijk: number[];
  uv: number[];
  emptyUV: number[];
  alphaBytes: { high: number; low: number; validity: number };
  scalar: number;
}
export function volumeDiagnosticShader(
  mode: VolumeDebugMode,
  probe: VolumeTexelProbe,
  dimensions: number[] = [160, 160, 149]
) {
  if (mode === 'magenta')
    return {
      entry: 'fragment' as const,
      uniforms: '',
      body: '_output_color = vec4(1.0, 0.0, 1.0, 1.0);',
      textures: [] as string[],
    };
  if (mode === 'samplers') {
    const uv = probe.uv.map((value) => value.toFixed(12)).join(',');
    const emptyUV = probe.emptyUV.map((value) => value.toFixed(12)).join(',');
    const expHigh = (probe.alphaBytes.high / 255).toFixed(12);
    const expLow = (probe.alphaBytes.low / 255).toFixed(12);
    const expVal = (probe.alphaBytes.validity / 255).toFixed(12);
    return {
      entry: 'surface' as const,
      uniforms: `uniform highp sampler2D u_high;\nuniform highp sampler2D u_low;\nuniform highp sampler2D u_validity;`,
      body: `highp vec2 probeUV = vec2(${uv});
highp vec2 emptyUV = vec2(${emptyUV});
highp float actualHigh = texture(u_high, probeUV).a;
highp float actualLow = texture(u_low, probeUV).a;
highp float actualVal = texture(u_validity, probeUV).a;
highp float emptyHigh = texture(u_high, emptyUV).a;
highp float emptyLow = texture(u_low, emptyUV).a;
highp float emptyVal = texture(u_validity, emptyUV).a;
highp float expHigh = ${expHigh};
highp float expLow = ${expLow};
highp float expVal = ${expVal};
highp float tol = 1.5 / 255.0;
bool passHigh = abs(actualHigh - expHigh) <= tol && emptyHigh <= tol;
bool passLow = abs(actualLow - expLow) <= tol && emptyLow <= tol;
bool passVal = abs(actualVal - expVal) <= tol && emptyVal <= tol;
bool passAll = passHigh && passLow && passVal;

highp vec2 tc = _surface.diffuse_texcoord;
if (tc.x < 0.08) {
  _surface.diffuse_color = (tc.y > 0.7) ? vec4(1.0, 1.0, 0.0, 1.0) : vec4(1.0, 0.0, 1.0, 1.0);
} else if (tc.y > 0.82) {
  _surface.diffuse_color = passAll ? vec4(0.0, 1.0, 0.0, 1.0) : vec4(1.0, 0.0, 0.0, 1.0);
} else {
  highp float actual = (tc.x < 0.386) ? actualHigh : ((tc.x < 0.693) ? actualLow : actualVal);
  highp float expected = (tc.x < 0.386) ? expHigh : ((tc.x < 0.693) ? expLow : expVal);
  highp float empty = (tc.x < 0.386) ? emptyHigh : ((tc.x < 0.693) ? emptyLow : emptyVal);
  highp float shade = (tc.y > 0.54) ? expected : ((tc.y > 0.26) ? actual : empty);
  _surface.diffuse_color = vec4(vec3(shade), 1.0);
}`,
      textures: ['high', 'low', 'validity'] as string[],
    };
  }
  if (mode === 'high' || mode === 'low' || mode === 'validity') {
    return {
      entry: 'surface' as const,
      uniforms: `uniform highp sampler2D u_${mode};`,
      body: `highp float actualAlpha = texture(u_${mode}, vec2(${probe.uv.map((value) => value.toFixed(12)).join(',')})).a;
highp float expectedAlpha = ${(probe.alphaBytes[mode] / 255).toFixed(12)};
highp float shade = _surface.diffuse_texcoord.y < 0.5 ? actualAlpha : expectedAlpha;
if (_surface.diffuse_texcoord.y < 0.2) shade = texture(u_${mode}, vec2(${probe.emptyUV.map((value) => value.toFixed(12)).join(',')})).a;
_surface.diffuse_color = _surface.diffuse_texcoord.x < 0.12 ? vec4(1.0,0.0,1.0,1.0) : vec4(vec3(shade),1.0);`,
      textures: [mode],
    };
  }
  if (mode === 'uniforms')
    return {
      entry: 'surface' as const,
      uniforms: VOLUME_SHADER_UNIFORMS.replace(/^uniform highp sampler2D .*;$/gm, ''),
      body: `bool medicalUniformOK = all(lessThan(abs(u_dimensions-vec3(${dimensions.map((value) => value.toFixed(1)).join(',')})),vec3(0.01))) && u_atlas.x > u_tile.x && u_scalar.w > 0.0 && u_appearance.x > 0.0 && all(greaterThan(u_crop_max,u_crop_min));
_surface.diffuse_color = medicalUniformOK ? vec4(0.0,1.0,0.0,1.0) : vec4(1.0,0.0,0.0,1.0);
if (_surface.diffuse_texcoord.x > 0.5) _surface.diffuse_color = vec4(u_crop_min,1.0);
if (_surface.diffuse_texcoord.y < 0.18) _surface.diffuse_color = vec4(vec3(clamp(u_appearance.x/11178.0,0.0,1.0)),1.0);`,
      textures: [] as string[],
    };
  if (mode === 'coordinates' || mode === 'ray') {
    const prefix = VOLUME_SHADER_BODY.slice(
      0,
      VOLUME_SHADER_BODY.indexOf('highp vec4 medicalColor')
    );
    return {
      entry: 'surface' as const,
      uniforms: VOLUME_SHADER_UNIFORMS.replace(/^uniform highp sampler2D .*;$/gm, ''),
      body:
        mode === 'coordinates'
          ? `${prefix}
_surface.diffuse_color = vec4(clamp(vec3(medicalPointLocal.x,-medicalPointLocal.z,medicalPointLocal.y)/u_extent+0.5,0.0,1.0),1.0);
if (_surface.diffuse_texcoord.x < .12) _surface.diffuse_color = vec4(clamp(medicalOrigin,0.0,1.0),1.0);`
          : `${prefix}
_surface.diffuse_color = medicalExit > medicalEntry ? vec4(0.0,1.0,clamp((medicalExit-medicalEntry)/300.0,0.0,1.0),1.0) : vec4(1.0,0.0,1.0,1.0);`,
      textures: [] as string[],
    };
  }
  return {
    entry: 'surface' as const,
    uniforms: VOLUME_SHADER_UNIFORMS,
    body:
      mode === 'opacity'
        ? VOLUME_SHADER_BODY.replace(
            '_surface.diffuse_color = vec4(medicalColor.rgb / max(medicalColor.a, 0.00001), medicalColor.a);',
            '_surface.diffuse_color = vec4(vec3(medicalColor.a), 1.0);'
          )
        : VOLUME_SHADER_BODY,
    textures: ['high', 'low', 'validity'],
  };
}
export function medicalNativeError(event: unknown) {
  const value = (event as { nativeEvent?: { error?: unknown } })?.nativeEvent?.error ?? event;
  return value instanceof Error
    ? value.message
    : typeof value === 'string'
      ? value
      : (JSON.stringify(value) ?? 'Native rendering error');
}
