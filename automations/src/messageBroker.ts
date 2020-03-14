import * as amqplib from 'amqplib';
import * as dotenv from 'dotenv';
import * as uuid from 'uuid';
import { checkTrigger } from './data/utils';
import { debugBase } from './debuggers';

dotenv.config();

const { RABBITMQ_HOST = 'amqp://localhost' } = process.env;

let conn;
let channel;

export const sendRPCMessage = async (message, channelTxt = 'rpc_queue:erxes-automations'): Promise<any> => {
  debugBase(`SendRPCMessage to queue ${JSON.stringify(message)}, ${channelTxt}`);

  const response = await new Promise((resolve, reject) => {
    const correlationId = uuid();

    return channel.assertQueue('', { exclusive: true }).then(q => {
      channel.consume(
        q.queue,
        msg => {
          if (!msg) {
            return reject(new Error('consumer cancelled by rabbitmq'));
          }

          if (msg.properties.correlationId === correlationId) {
            const res = JSON.parse(msg.content.toString());

            if (res.status === 'success') {
              resolve(res.data);
            } else if (res.status === 'notFound') {
              resolve();
            } else {
              reject(res.errorMessage);
            }

            channel.deleteQueue(q.queue);
          }
        },
        { noAck: true },
      );

      channel.sendToQueue(channelTxt, Buffer.from(JSON.stringify(message)), {
        correlationId,
        replyTo: q.queue,
      });
    });
  });

  return response;
};

export const sendMessage = async (queueName: string, data?: any) => {
  await channel.assertQueue(queueName);
  await channel.sendToQueue(queueName, Buffer.from(JSON.stringify(data || {})));
};

const consumerHelperCheckTrigger = async msg => {
  if (msg !== null) {
    debugBase(`Received rpc queue message ${msg.content.toString()}`);

    const parsedObject = JSON.parse(msg.content.toString());

    const { action, data } = parsedObject;

    let response = { status: 'error', data: {} };

    if (action === 'get-response-check-automation') {
      const triggerResponse = await checkTrigger(data);

      response = {
        status: 'success',
        data: triggerResponse,
      };
    }

    channel.sendToQueue(msg.properties.replyTo, Buffer.from(JSON.stringify(response)), {
      correlationId: msg.properties.correlationId,
    });

    channel.ack(msg);
  }
};

const initConsumer = async () => {
  // Consumer
  try {
    conn = await amqplib.connect(RABBITMQ_HOST);
    channel = await conn.createChannel();

    // listen for rpc queue =========
    await channel.assertQueue('rpc_queue:erxes-api');
    channel.consume('rpc_queue:erxes-api', async msg => {
      consumerHelperCheckTrigger(msg);
    });

    await channel.assertQueue('rpc_queue:erkhet');
    channel.consume('rpc_queue:erkhet', async msg => {
      consumerHelperCheckTrigger(msg);
    });
  } catch (e) {
    debugBase(e.message);
  }
};

initConsumer();
