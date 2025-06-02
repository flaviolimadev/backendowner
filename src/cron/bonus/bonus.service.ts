import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

@Injectable()
export class BonusService {
  private supabase;

  // Porcentagens de comissão por nível - ajustadas conforme solicitado
  private porcentagens = {
    1: 10, // Indicação direta - 10%
    2: 4,  // 2° nível - 4%
    3: 3,  // 3° nível - 3%
    4: 2,  // 4° nível - 2%
    5: 1,  // 5° nível - 1%
  };

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_KEY ausentes');
    this.supabase = createClient(url, key);
  }

  @Cron('*/1 * * * *') // Executa a cada 1 minuto
  async gerarBonusMultinivel() {
    const { data: depositos, error } = await this.supabase
      .from('depositos')
      .select('id, profile_id, value')
      .eq('status', 1);

    if (error) throw new Error(error.message);
    const timestamp = new Date().toISOString();

    for (const deposito of depositos) {
      let userId = deposito.profile_id;
      let depositoId = deposito.id;
      let valorDeposito = deposito.value;
      let nivel = 1;

      while (nivel <= 5) { // Agora só vai até o nível 5
        // Busca o usuário que fez o depósito
        const { data: user } = await this.supabase
          .from('profiles')
          .select('referred_at')
          .eq('id', userId)
          .single();

        if (!user?.referred_at) break; // se não há quem indicou, fim da bonificação

        // Busca o ID do usuário indicador pelo username
        const { data: referrer } = await this.supabase
          .from('profiles')
          .select('id')
          .eq('id', user.referred_at)
          .single();
          
        if (!referrer?.id) break; // se não encontrou o indicador, fim da bonificação
        
        const refId = referrer.id;
        const percentual = this.porcentagens[nivel];
        const comissao = Math.floor(valorDeposito * (percentual / 100));
        const tipo = nivel === 1 ? 2 : 3;

        // Buscar nome do usuário que depositou para usar na descrição
        const { data: quemDepositou } = await this.supabase
          .from('profiles')
          .select('nome')
          .eq('id', deposito.profile_id)
          .single();

        const nomeUsuario = quemDepositou?.nome ?? 'usuário desconhecido';

        // Criar registro na tabela extrato
        await this.supabase.from('extrato').insert([
          {
            profile_id: refId,
            value: comissao,
            type: nivel === 1 ? 'bonus_direto' : 'bonus_indireto',
            status: 'completed',
            descricao: `Bônus nível ${nivel} gerado pelo depósito de ${nomeUsuario}`,
            created_at: timestamp,
            updated_at: timestamp,
          },
        ]);

        // Atualizar saldo do referido
        const { data: saldoAtual } = await this.supabase
          .from('profiles')
          .select('balance')
          .eq('id', refId)
          .single();

        await this.supabase
          .from('profiles')
          .update({ balance: saldoAtual.balance + comissao })
          .eq('id', refId);

        userId = refId;
        nivel++;
      }

      // Finaliza o processamento do depósito
      await this.supabase
        .from('depositos')
        .update({ status: 2, updated_at: timestamp })
        .eq('id', depositoId);
    }

    console.log(`[Cron] Bonificações processadas às ${new Date().toLocaleString()}`);
  }
}
