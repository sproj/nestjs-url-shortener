import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { CodeGenerator } from './code-generator.interface.js';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CODE_LENGTH = 7;

@Injectable()
export class Base62CodeGenerator implements CodeGenerator {
  generate(): string {
    const bytes = randomBytes(CODE_LENGTH * 2);
    let code = '';
    for (let i = 0; i < bytes.length && code.length < CODE_LENGTH; i++) {
      const val = bytes[i];
      if (val < 248) {
        code += ALPHABET[val % 62];
      }
    }
    // Extremely unlikely, but pad with a second pass if needed
    while (code.length < CODE_LENGTH) {
      code += ALPHABET[randomBytes(1)[0] % 62];
    }
    return code;
  }
}
