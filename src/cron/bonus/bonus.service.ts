import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

@Injectable()
export class BonusService {
  private supabase;
  private isProcessing = false;

  private porcentagens = {
    1: 10,
    2: 5,
    3: 4,
    4: 2,
    5: 2,
    6: 1,
    7: 1,
    8: 1,
  };

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_KEY ausentes');
    this.supabase = createClient(url, key);
  }

  @Cron('*/1 * * * *')
  async gerarBonusMultinivel() {
    if (this.isProcessing) {
      console.log('Já existe um processamento de bônus em andamento. Pulando execução.');
      return;
    }

    try {
      this.isProcessing = true;
      console.log('Iniciando processamento de bônus');
      
      const { data: depositos, error } = await this.supabase
        .from('depositos')
        .select('id, profile_id, value')
        .eq('status', 1);

      if (error) {
        console.error('Erro ao buscar depósitos:', error.message);
        return;
      }

      if (!depositos || depositos.length === 0) {
        console.log('Nenhum depósito pendente');
        return;
      }

      console.log(`Encontrados ${depositos.length} depósitos para processamento`);
      const timestamp = new Date().toISOString();

      for (const deposito of depositos) {
        try {
          console.log(`Processando depósito ID: ${deposito.id}`);
          
          let userId = deposito.profile_id;
          let depositoId = deposito.id;
          let valorDeposito = deposito.value;
          let nivel = 1;

          while (nivel <= 8) {
            const { data: user, error: userError } = await this.supabase
              .from('profiles')
              .select('referred_at')
              .eq('id', userId)
              .single();

            if (userError || !user?.referred_at) {
              console.log(`Nível ${nivel}: Fim da cadeia para usuário ${userId}`);
              break;
            }

            const { data: referrer, error: referrerError } = await this.supabase
              .from('profiles')
              .select('id')
              .eq('user_id', user.referred_at)
              .single();
              
            if (referrerError || !referrer?.id) {
              console.log(`Nível ${nivel}: Indicador não encontrado para ${user.referred_at}`);
              break;
            }
            
            const refId = referrer.id;
            const percentual = this.porcentagens[nivel];
            const comissao = Math.floor(valorDeposito * (percentual / 100) * 100); // EM CENTAVOS

            console.log(`Nível ${nivel}: Comissão de ${comissao} centavos para usuário ${refId}`);

            const { data: quemDepositou } = await this.supabase
              .from('profiles')
              .select('nome')
              .eq('id', deposito.profile_id)
              .single();

            const nomeUsuario = quemDepositou?.nome ?? 'usuário desconhecido';
            
            const extratoData = {
              profile_id: refId,
              value: comissao,
              type: 'deposito',
              status: 'completed',
              descricao: `Bônus nível ${nivel} de ${nomeUsuario}`,
              created_at: timestamp,
              updated_at: timestamp,
              reference_id: deposito.id
            };
            
            const { error: extratoError } = await this.supabase
              .from('extrato')
              .insert([extratoData]);

            if (extratoError) {
              console.error(`Erro ao inserir no extrato: ${extratoError.message}`);
            } else {
              console.log(`Extrato criado para usuário ${refId}`);
            }

            const { data: perfilAtual } = await this.supabase
              .from('profiles')
              .select('balance')
              .eq('id', refId)
              .single();
            
            if (perfilAtual) {
              const novoSaldo = (perfilAtual.balance || 0) + comissao;
              
              const { error: updateError } = await this.supabase
                .from('profiles')
                .update({ balance: novoSaldo })
                .eq('id', refId);

              if (updateError) {
                console.error(`Erro ao atualizar saldo: ${updateError.message}`);
              } else {
                console.log(`Saldo atualizado para ${novoSaldo} centavos`);
              }
            }

            userId = refId;
            nivel++;
          }

          await this.supabase
            .from('depositos')
            .update({ status: 2 })
            .eq('id', depositoId);
          
          console.log(`Depósito ${depositoId} finalizado`);
        } catch (err) {
          console.error(`Erro ao processar depósito ${deposito.id}:`, err);
        }
      }

      console.log(`Processamento de bonificações concluído às ${new Date().toLocaleString()}`);
    } catch (error) {
      console.error('Erro geral no processamento de bônus:', error);
    } finally {
      this.isProcessing = false;
    }
  }
}
