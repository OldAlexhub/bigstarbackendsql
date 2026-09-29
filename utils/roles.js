export const SUPER_ADMIN_ROLE = "Super Admin";
export const ELT_ROLE = "ELT";
export const GLOBAL_ADMIN_ROLES = [SUPER_ADMIN_ROLE, ELT_ROLE];

export const isSuperAdmin = (user) => user?.role === SUPER_ADMIN_ROLE;
export const isGlobalAdmin = (user) => GLOBAL_ADMIN_ROLES.includes(user?.role);
