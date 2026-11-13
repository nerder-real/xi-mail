export function isSecureSecret(secret) {
	return typeof secret === 'string' && secret.length >= 32 && new Set(secret).size >= 12
		&& !/(?:\$\{JWT_SECRET\}|<[^>]+>|your[-_ ]|change[-_ ]?me|example)/i.test(secret);
}

// 初始化密钥（init_secret）仅用于一次性迁移数据库，最低 4 位；
// 但仍拒绝会破坏 /api/init/<secret> URL 路径的字符。
export function isUsableInitSecret(secret) {
	return typeof secret === 'string' && secret.length >= 4 && !/[/?#%\\\s]/.test(secret);
}
