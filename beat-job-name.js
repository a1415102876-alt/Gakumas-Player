const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])\s*(?:\.|$)/iu;

export function normalizeBeatJobName(value) {
    const name = String(value ?? '').trim().normalize('NFC');
    if (!name) throw new Error('请输入脚本名称。');
    if (name.length > 80 || name.startsWith('.') || name.endsWith('.')
        || /[<>:"/\\|?*\u0000-\u001f\u007f\p{Cs}]/u.test(name) || WINDOWS_DEVICE_NAME.test(name)) {
        throw new Error('脚本名称需在 80 个字符以内，并符合 Windows 文件命名规则。');
    }
    return name;
}
