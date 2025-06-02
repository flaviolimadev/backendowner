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
        'MzlkZmQxOGUtNmEyOC00ODllLThjNGYtMDJmOGNmYTlhZTk1OjEyNzgzYjU2LTU5ODktNGE0NS1hNDE1LTJiNjE4ZDZmOGZmNg==',
      'Content-Type': 'application/json',
    };

    const response = await axios.post(url, { grant_type: 'client_credentials' }, { headers });
    return response.data.access_token;
  }

  @Cron(CronExpression.EVERY_MINUTE) // Executa a cada minuto
  async executarSaquesPix() {
    this.logger.log('🚀 Verificando saques pendentes via Pix...');

    try {
      const { data: saques, error } = await supabase
        .from('saques')
        .select('id, profile_id, value, carteira, cpf')
        .eq('status', 0)
        .eq('type', 1); // Apenas saques do tipo PIX

      if (error) {
        this.logger.error(`❌ Erro ao buscar saques pendentes: ${error.message}`);
        return;
      }

      if (!saques || saques.length === 0) {
        this.logger.log('Nenhum saque pendente encontrado.');
        return;
      }

      const token = await this.generateToken();

      for (const saque of saques) {
        try {
          // Buscar nome do usuário - primeiro tentando pelo id
          let profileData;
          
          const { data: profileById, error: errorById } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', saque.profile_id)
            .single();
            
          if (!errorById && profileById) {
            profileData = profileById;
          } else {
            // Se não encontrou pelo id, tenta pelo user_id
            const { data: profileByUserId, error: errorByUserId } = await supabase
              .from('profiles')
              .select('name')
              .eq('user_id', saque.profile_id)
              .single();
              
            if (errorByUserId || !profileByUserId) {
              this.logger.warn(`⚠️ Usuário não encontrado: ${saque.profile_id}`);
              continue;
            }
            
            profileData = profileByUserId;
          }

          const saqueCents = Math.floor(saque.value * 6);
          const idempotentId = uuidv4().replace(/[^a-zA-Z0-9]/g, '');

          const pix_key_type = this.detectPixKeyType(saque.carteira);

          const dataPix = {
            initiation_type: 'dict',
            idempotent_id: idempotentId,
            receiver_name: profileData.name,
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

            await supabase.from('transactions').insert({
              user_id: saque.profile_id,
              amount: saque.value,
              type: 'withdrawal',
              status: 'completed',
              description: 'Saque Pix realizado com sucesso',
              reference_id: saque.id,
            });

            this.logger.log(`✅ Saque Pix efetuado para ${profileData.name}: ${saque.value / 100} USD`);
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

          await supabase.from('transactions').insert({
            user_id: saque.profile_id,
            amount: saque.value,
            type: 'withdrawal',
            status: 'failed',
            description: 'Erro ao processar saque Pix',
            reference_id: saque.id,
          });
        }
      }
    } catch (error) {
      this.logger.error(`❌ Erro ao executar serviço de saques: ${error.message}`);
    }
  }

  private detectPixKeyType(chave: string): 'email' | 'cpf' | 'phone' {
    if (chave.includes('@')) return 'email';
    if (/^\+55\d{11}$/.test(chave)) return 'phone';
    if (/^\d{11}$/.test(chave)) return 'cpf';
    throw new Error(`Tipo de chave Pix inválido: ${chave}`);
  }
}
