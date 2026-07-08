export const CODE_GENERATOR = 'CODE_GENERATOR';

export interface CodeGenerator {
  generate(): string;
}
