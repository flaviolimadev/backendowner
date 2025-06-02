import { Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { supabase } from '../supabase/supabase.service';

@Injectable()
export class PagamentoService {
  async generateToken(): Promise<string> {
    const url = 'https://api.primepag.com.br/auth/generate_token';

    const headers = {
      Authorization:
        'MzlkZmQxOGUtNmEyOC00ODllLThjNGYtMDJmOGNmYTlhZTk1OjEyNzgzYjU2LTU5ODktNGE0NS1hNDE1LTJiNjE4ZDZmOGZmNg==',
      'Content-Type': 'application/json',
    };

    const response = await axios.post(url, { grant_type: 'client_credentials' }, { headers });
    return response.data.access_token;
  }

  async generateQRCode(userId: string, valor: number, cpf: string, metodo: number) {
    // 1. Buscar nome - tenta primeiro pelo campo user_id
    let { data: user, error } = await supabase
      .from('profiles')
      .select('nome')
      .eq('user_id', userId)
      .single();
    
    // Se não encontrou pelo user_id, tenta pelo id
    if (error || !user) {
      const result = await supabase
        .from('profiles')
        .select('nome')
        .eq('id', userId)
        .single();
      
      user = result.data;
      error = result.error;
    }
  
    if (error || !user) {
      throw new NotFoundException('Usuário não encontrado no Supabase');
    }
  
    // 2. Gerar token + chamada à API
    const token = await this.generateToken();
  
    const url = 'https://api.primepag.com.br/v1/pix/qrcodes';
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  
    const data = {
      value_cents: Math.round(valor * 100),
      generator_name: user.nome,
      generator_document: cpf,
      expiration_time: '1800',
      external_reference: 'OWNER-PAYMENTS',
    };
  
    const response = await axios.post(url, data, { headers });
    const responseData = response.data;
    const txid = responseData.qrcode.reference_code;
  
    // 3. Salvar depósito no Supabase
    await supabase.from('depositos').insert({
      profile_id: userId,
      txid: txid,
      value: Math.round((valor * 100)/6),
      type: metodo,
      status: 0, // pendente
      descricao: 'Gerado via API',
      bonus: false,
    });
  
    // 4. Retornar ao frontend
    return {
      qrcode: responseData.qrcode.image_base64,
      chave: responseData.qrcode.content,
      txid: txid,
      valor: valor,
    };
  }
  
  
}
