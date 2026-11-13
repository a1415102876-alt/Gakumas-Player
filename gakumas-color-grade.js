// Shared scene grading for direct rendering and the HDR post composite.
export const GRADE_GLSL = `
uniform float gkDeferGrade;
uniform float gkExposure;
uniform float gkContrast;
uniform float gkSaturation;
uniform vec3 gkColorFilter;
uniform vec4 gkTone;
uniform float gkToneEnabled;
uniform vec3 gkShadows;
uniform vec3 gkMidtones;
uniform vec3 gkHighlights;
uniform vec4 gkSmhLimits;

vec3 gkLinearToLogC(vec3 x) {
    vec3 hi = 0.244161 * (log(5.555556 * x + 0.047996) / log(10.0)) + 0.386036;
    vec3 lo = 5.301883 * x + 0.092819;
    return mix(lo, hi, step(vec3(0.011361), x));
}

vec3 gkLogCToLinear(vec3 x) {
    vec3 hi = (pow(vec3(10.0), (x - 0.386036) / 0.244161) - 0.047996) / 5.555556;
    vec3 lo = (x - 0.092819) / 5.301883;
    return mix(lo, hi, step(vec3(5.301883 * 0.011361 + 0.092819), x));
}

vec3 gkUchimura(vec3 x, float a, float m, float l, float c) {
    float P = 1.0;
    float l0 = ((P - m) * l) / a;
    float S0 = m + l0;
    float S1 = m + a * l0;
    float C2 = (a * P) / (P - S1);
    float CP = -C2 / P;
    vec3 w0 = 1.0 - smoothstep(0.0, m, x);
    vec3 w2 = step(S0, x);
    vec3 w1 = 1.0 - w0 - w2;
    vec3 T = m * pow(max(x, vec3(0.0)) / m, vec3(c));
    vec3 S = P - (P - S1) * exp(CP * (x - S0));
    vec3 L = m + a * (x - m);
    return T * w0 + L * w1 + S * w2;
}

vec3 gkGradeColor(vec3 color) {
    color *= gkExposure;
    vec3 logc = gkLinearToLogC(max(color, vec3(0.0)));
    color = gkLogCToLinear((logc - ${0.4135884}) * gkContrast + ${0.4135884});
    color = max(color * gkColorFilter, vec3(0.0));
    float luma = dot(color, vec3(0.2126729, 0.7151522, 0.0721750));
    float shadowsFactor = 1.0 - smoothstep(gkSmhLimits.x, gkSmhLimits.y, luma);
    float highlightsFactor = smoothstep(gkSmhLimits.z, gkSmhLimits.w, luma);
    color *= gkShadows * shadowsFactor + gkMidtones * (1.0 - shadowsFactor - highlightsFactor) + gkHighlights * highlightsFactor;
    luma = dot(color, vec3(0.2126729, 0.7151522, 0.0721750));
    color = max(vec3(luma) + (color - vec3(luma)) * gkSaturation, vec3(0.0));
    if (gkToneEnabled > 0.5) color = gkUchimura(color, gkTone.z, gkTone.x, gkTone.y, gkTone.w);
    return color;
}
vec3 gkGrade(vec3 color) {
    return gkDeferGrade > 0.5 ? color : gkGradeColor(color);
}
`;
