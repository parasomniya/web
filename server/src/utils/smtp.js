import nodemailer from 'nodemailer';

export function isSmtpConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export function getSmtpUser() {
    return String(process.env.SMTP_USER || '').trim().toLowerCase();
}

export function parseSmtpPort() {
    const port = Number(process.env.SMTP_PORT || 465);
    return Number.isInteger(port) && port > 0 ? port : 465;
}

export function parseSmtpSecure(port) {
    if (process.env.SMTP_SECURE !== undefined) {
        return String(process.env.SMTP_SECURE).trim().toLowerCase() === 'true';
    }

    return port === 465;
}

export function createTransporter() {
    const port = parseSmtpPort();

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: parseSmtpSecure(port),
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

export function buildSenderEnvelope(preferredEmail, fallbackName = 'Кормление КРС') {
    const smtpUser = getSmtpUser();
    const normalizedPreferred = String(preferredEmail || '').trim().toLowerCase();
    const safeName = String(fallbackName || '').trim() || 'Кормление КРС';

    if (!smtpUser) {
        return {
            from: normalizedPreferred || '',
            replyTo: normalizedPreferred || undefined
        };
    }

    if (normalizedPreferred && normalizedPreferred === smtpUser) {
        return {
            from: smtpUser,
            replyTo: undefined
        };
    }

    return {
        from: `"${safeName.replace(/"/g, "'")}" <${smtpUser}>`,
        replyTo: normalizedPreferred || undefined
    };
}
