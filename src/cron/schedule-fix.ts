// Patch para o problema de crypto.randomUUID()
try {
  // Verificar se estamos em Node.js v18 ou anterior
  if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.randomUUID === 'undefined') {
    console.log('Aplicando patch para crypto.randomUUID()...');
    
    // Importar randomUUID do módulo crypto nativo
    const { randomUUID } = require('crypto');
    
    // Criar objeto crypto global se não existir
    if (typeof globalThis.crypto === 'undefined') {
      // @ts-ignore
      globalThis.crypto = {};
    }
    
    // Adicionar método randomUUID
    // @ts-ignore
    if (typeof globalThis.crypto.randomUUID === 'undefined') {
      // @ts-ignore
      globalThis.crypto.randomUUID = randomUUID;
    }
    
    console.log('Patch aplicado com sucesso!');
  }
} catch (error) {
  console.error('Erro ao aplicar patch para crypto.randomUUID():', error);
} 