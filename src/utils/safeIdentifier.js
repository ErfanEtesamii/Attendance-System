function assertSafeIdentifier(name) { if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('SQL identifier نامعتبر است.'); return name; }
module.exports = { assertSafeIdentifier };
