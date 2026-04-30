CREATE TABLE "DigestSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "senderEmail" TEXT NOT NULL DEFAULT '',
    "sendTime" TEXT NOT NULL DEFAULT '08:00',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Novosibirsk',
    "recipientsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "DigestSettings" (
    "id",
    "enabled",
    "senderEmail",
    "sendTime",
    "timezone",
    "recipientsJson",
    "createdAt",
    "updatedAt"
) VALUES (
    1,
    false,
    '',
    '08:00',
    'Asia/Novosibirsk',
    '[]',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);
