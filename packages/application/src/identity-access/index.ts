// Identity&Access module public barrel (Architecture §7, §12).
// Owns: AccessGate (can/scopeQuery), Auth.js integration points, RoleAssignment
// use cases, Invite consumption. Only this file is importable from outside
// this folder — enforced by dependency-cruiser rule "no-reach-into-identity-access-internals".
// Landing starting Level 1.3/1.5.

export const IDENTITY_ACCESS_MODULE = 'identity-access';
