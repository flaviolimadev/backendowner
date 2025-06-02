// Script de inicialização personalizado que garante o patch do crypto
console.log('Iniciando aplicação com patch para crypto...');

// Aplicar patch para crypto.randomUUID()
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {};
}

if (typeof globalThis.crypto.randomUUID === 'undefined') {
  const { randomUUID } = require('crypto');
  globalThis.crypto.randomUUID = function() {
    return randomUUID();
  };
  console.log('Patch para crypto.randomUUID aplicado!');
}

// Iniciar a aplicação NestJS
require('./dist/main'); 