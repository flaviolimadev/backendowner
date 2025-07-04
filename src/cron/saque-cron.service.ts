import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { supabase } from '../supabase/supabase.service';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SaqueCronService {
  private readonly logger = new Logger(SaqueCronService.name);

  async generateToken(): Promise<string> {
    const url = 'https://api.primepag.com.br/auth/generate_token';

    const headers = {
      Authorization:
        'NDNlOTE5ZDEtOTgzNC00OTMyLTk5ZDAtZjU5YjQwMmM0NmU0OjAxZjU5NTUxLWViZjgtNDZhZC04NTFmLWQ1ZWJjMjg3YzE3YQ==',
      'Content-Type': 'application/json',
    };

    const response = await axios.post(url, { grant_type: 'client_credentials' }, { headers });
    return response.data.access_token;
  }

  @Cron(CronExpression.EVERY_MINUTE) // Executa a cada minuto
  async executarSaquesPix() {
    this.logger.log('🚀 Verificando saques pendentes via Pix...');

    const { data: saques, error } = await supabase
      .from('saques')
      .select('id, profile_id, value, carteira, cpf')
      .eq('status', 0)
      .eq('type', 1); // Apenas saques do tipo PIX

    if (error || !saques) {
      this.logger.error('❌ Erro ao buscar saques pendentes.');
      return;
    }

    const token = await this.generateToken();

    for (const saque of saques) {
      try {
        // Buscar nome do usuário
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('nome')
          .eq('id', saque.profile_id)
          .single();

        if (profileError || !profile) {
          this.logger.warn(`⚠️ Usuário não encontrado: ${saque.profile_id}`);
          continue;
        }

        const saqueCents = saque.value; // valor já em centavos
        const idempotentId = uuidv4().replace(/[^a-zA-Z0-9]/g, '');

        const pix_key_type = this.detectPixKeyType(saque.carteira);

        const dataPix = {
          initiation_type: 'dict',
          idempotent_id: idempotentId,
          receiver_name: profile.nome,
          receiver_document: saque.cpf, // Vem do banco agora
          value_cents: saqueCents,
          pix_key_type,
          pix_key: saque.carteira,
          authorized: true,
        };

        const headers = {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        };

        const response = await axios.post(
          'https://api.primepag.com.br/v1/pix/payments',
          dataPix,
          { headers },
        );

        if (response.data && response.data.payment) {
          await supabase.from('saques').update({ status: 1 }).eq('id', saque.id);

          await supabase.from('extrato').insert({
            user_id: saque.profile_id,
            amount: saque.value,
            type: 'withdrawal',
            status: 'completed',
            description: 'Saque Pix realizado com sucesso',
            reference_id: saque.id,
          });

          this.logger.log(`✅ Saque Pix efetuado para ${profile.nome}: ${saque.value / 100} R$`);
        } else {
          throw new Error('Resposta inválida da API PrimePag');
        }
      } catch (err) {
        this.logger.warn(`❌ Falha ao processar saque ID ${saque.id}: ${err.message}`);

        await supabase.rpc('incrementar_balance', {
          uid: saque.profile_id,
          quantia: saque.value,
        });

        await supabase.from('saques').update({ status: 2 }).eq('id', saque.id);

        await supabase.from('extrato').insert({
          user_id: saque.profile_id,
          amount: saque.value,
          type: 'withdrawal',
          status: 'failed',
          description: 'Erro ao processar saque Pix',
          reference_id: saque.id,
        });
      }
    }
  }

  private detectPixKeyType(chave: string): 'email' | 'cpf' | 'phone' {
    if (chave.includes('@')) return 'email';
    if (/^\+55\d{11}$/.test(chave)) return 'phone';
    if (/^\d{11}$/.test(chave)) return 'cpf';
    throw new Error(`Tipo de chave Pix inválido: ${chave}`);
  }
}