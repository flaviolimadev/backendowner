// Patch para o problema de crypto.randomUUID()
import { randomUUID } from 'crypto';

// Adicionar randomUUID ao objeto global crypto se não existir
if (typeof global.crypto === 'undefined') {
  // @ts-ignore
  global.crypto = {};
}

// @ts-ignore
if (typeof global.crypto.randomUUID === 'undefined') {
  // @ts-ignore
  global.crypto.randomUUID = randomUUID;
} 