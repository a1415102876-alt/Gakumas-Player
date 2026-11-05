// Standalone defaults from Hatsuboshi app.js idols[*].theme.
// Embedded Beat reads the current frontend configuration via resolveSpeakerTheme.
const IDOL_COLORS = Object.freeze({
    "藤田琴音": "#FAD356",
    "月村手毬": "#4FA0CE",
    "花海咲季": "#EA4A5B",
    "花海佑芽": "#ff5f4f",
    "筱泽广": "#48C6DA",
    "十王星南": "#F9C584",
    "秦谷美铃": "#A0B6DC",
    "仓本千奈": "#F8AC5E",
    "葛城莉莉娅": "#EFFDFF",
    "紫云清夏": "#A2FD47",
    "有村麻央": "#A453A6",
    "姬崎莉波": "#F9C4D6",
    "雨夜燕": "#a396f3"
});
const NEUTRAL_COLOR = '#978c83';
const DARK_TEXT = '#243036';

function luminance(color) {
    const channels = color.slice(1).match(/../g).map(value => {
        const channel = parseInt(value, 16) / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}

export function beatSpeakerStyle(name, resolveTheme) {
    const configured = typeof resolveTheme === 'function' ? resolveTheme(name) : '';
    const color = /^#[0-9a-f]{6}$/iu.test(configured || '') ? configured : IDOL_COLORS[name] || NEUTRAL_COLOR;
    const lightness = luminance(color);
    const whiteContrast = 1.05 / (lightness + .05);
    const darkContrast = (lightness + .05) / (luminance(DARK_TEXT) + .05);
    return { color, textColor: darkContrast >= whiteContrast ? DARK_TEXT : '#ffffff' };
}
