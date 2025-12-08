import { customAlphabet } from "nanoid";

const nano = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);

export const makeAsmCode = () => `ASM-${nano()}`;
export const makeRmCode = () => `RM-${nano()}`;
export const makePartnerCode = () => `PT-${nano()}`;
