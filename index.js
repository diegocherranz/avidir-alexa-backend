// Include the Alexa SDK v2
const Alexa = require("ask-sdk-core");
const https = require("https");
const dynamodbFunciones = require('./serviceDB/funciones');
const moment = require('moment-timezone')


// The "LaunchRequest" intent handler - called when the skill is launched
const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  async handle(handlerInput) {
    const { attributesManager, serviceClientFactory, requestEnvelope } = handlerInput;
    const requestAttributes = attributesManager.getRequestAttributes();
    const sessionAttributes = attributesManager.getSessionAttributes();
    let accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
    let dynamicEntityActividades = [];

    if (accessToken === undefined) {
      var speechText = "Bienvenido a Avidir! Vaya, parece que es tu primera vez. Necesitarás autenticarte desde la aplicación de Alexa en tu dispositivo móvil para poder usarme. Te he mandado las instrucciones";

      return handlerInput.responseBuilder
        .speak(speechText)
        .withLinkAccountCard()
        .getResponse();
    } else {
      //let accessToken = handlerInput.requestEnvelope.context.System.user.accessToken;
      let url = `https://api.amazon.com/user/profile?access_token=${accessToken}`;
      /*
      * data.user_id : "amzn1.account.xxxxxxxxxx"
      * data.email : "steve@dabblelab.com"
      * data.name : "Steve Tingiris"
      * data.postal_code : "33607"
      */
      let outputSpeech = 'This is the default message.';

      const datos = await getRemoteData(url)
        .then((response) => {
          const data = JSON.parse(response);
          return data;
          //outputSpeech = `Hola ${data.name}!. Bienvenido`;


        })
        .catch((err) => {
          //set an optional error message here
          outputSpeech = err.message;
        });

      const user = await dynamodbFunciones.getUserbyEmail(datos.email)
        .then((resp) => {
          const usuario = resp;//JSON.parse(resp);
          if (usuario)
            outputSpeech = `Hola ${usuario.nombre}`;
          return usuario;
        })

      if (user == null || user == undefined) {
        outputSpeech = `Vaya, parece que aún no han vinculado su cuenta de Alexa con Avidir, por favor, contacte con su cuidador.`;

        return handlerInput.responseBuilder
          .speak(outputSpeech)
          .getResponse();
      }
      else {
        sessionAttributes['user_uuid'] = user.uuid;
        sessionAttributes['user_nombre'] = user.nombre;
        sessionAttributes['email_alexa'] = datos.email;


        //Reminders
        //const upsServiceClient = serviceClientFactory.getUpsServiceClient();
        console.log("antes de try permissions")
        try {
          console.log("empieza try permissions")
          const { permissions } = requestEnvelope.context.System.user;
          if (!permissions) {
            console.log("NO PERMISOS")
            throw { statusCode: 401, message: 'Permisos no disponibles' };

          }
          console.log("SIII PERMISOS");



          const reminderServiceClient = serviceClientFactory.getReminderManagementServiceClient();
          console.log("GET REMINDER MANAGEMENT SERVICE CLIENT")
          const remindersList = await reminderServiceClient.getReminders();
          console.log("hey despues de obtener todos los reminders")
          console.log('Current reminders: ' + JSON.stringify(remindersList));
          let date_compare = moment().tz('Europe/Madrid').subtract(1, 'days');
          let delete_all_reminders = false;
          if (remindersList.alerts.length > 0) {
            if (date_compare.isAfter(moment(remindersList.alerts[0].createdTime))){
              console.log("BORRAR REMINDERS SI")
            delete_all_reminders = true
            }
          }

          if (delete_all_reminders) {
            await Promise.all(
              remindersList.alerts.filter(reminder => reminder.status !== 'COMPLETED').map(async (reminder) => {
                
                return await reminderServiceClient.deleteReminder(reminder.alertToken)
              })
            )
          }

          /*if (remindersList.alerts.length > 0) {
            let reminders_eliminar = remindersList.alerts.filter(reminder => {
              let date_compare = moment().tz('Europe/Madrid').subtract(2, 'days');
              let date_reminder_created = moment(reminder.createdTime);
              if (date_compare.isBefore(date_reminder_created)) return true;
              else return false;
            })

            const reminders_eliminados = await Promise.all(
              reminders_eliminar.map(async (reminder) => {
                return await reminderServiceClient.deleteReminder(reminder.alertToken)
              })
            )

            console.log(reminders_eliminados);

            const delete_reminders_table = await dynamodbFunciones.deleteReminders(reminders_eliminar);

          }*/



          if (delete_all_reminders || remindersList.alerts.length === 0) {
            console.log("OBTENER TODAS LAS ACTIVIDADES")
            let actividades_user = await dynamodbFunciones.getActividadesByUserID(user.uuid);
            /*let reminders_table_user = await dynamodbFunciones.getRemindersByUserID(user.uuid);
            let actividades_con_reminder = reminders_table_user.map(reminder => {
              return reminder.uuid_act;
            })*/
            console.log("ACTIVIDADES DEL USER: " + JSON.stringify(actividades_user));

            let crear_reminders_obj = actividades_user.map(actividad => {
              console.log("CREAR REMINDER OBJ DE LA ACTIVIDAD " + JSON.stringify(actividad))
              return dynamodbFunciones.crearReminderObj(actividad)
            })

            const crear_reminders_noemptyobj = crear_reminders_obj.filter(element => {
              if (Object.keys(element).length !== 0) {
                return true;
              }

              return false;
            });

            console.log("reminders objetos creados son: " + JSON.stringify(crear_reminders_obj));

            const reminders_creados = await Promise.all(
              crear_reminders_noemptyobj.map(async (reminder) => {
                return await reminderServiceClient.createReminder(reminder)
              })
            )

            console.log("REMINDERS CREADOS  " + JSON.stringify(reminders_creados));
          }




        } catch (error) {
          console.log(JSON.stringify(error));
        }


        //Launch

        //Obtener todas las actividades

        const actividades_hoy = await dynamodbFunciones.getTodasActividadesHoy(user.uuid)
          .then((resp) => {
            const actividades = resp;
            outputSpeech = `Hola ${user.nombre}, tus actividades hoy son: ` + actividades.map(act => { return act.titulo + ", " }) + `. Has finalizado alguna?`
            return actividades;
          })


          //Obtener actividades pendientes y reemplazar slot value dynamic.

        if (actividades_hoy.length > 0) {
          let actividades_pendientes = [];
          actividades_pendientes = await dynamodbFunciones.getActividadesHoyPendientes(user.uuid)
            .then((resp) => {
              const actividades = resp;
              actividades.map((act) => {
                let slotValue = {
                  'id': act.uuid,
                  'name': {
                    'value': act.titulo.toLowerCase(),
                    'synonyms': [
                    ]
                  }
                }

                dynamicEntityActividades.push(slotValue);
              })
              outputSpeech = `Hola ${user.nombre}, tus actividades pendientes hoy son: ` + actividades.map(act => { return act.titulo + ", " }) + `. Deseas completar alguna o saber la próxima actividad?`
              return actividades;
            })


            // Si no hay actividades pendientes obtenemos la próxima actividad

          if (actividades_pendientes.length === 0) {
            outputSpeech = `Hola ${user.nombre}, parece que no tienes actividades pendientes por ahora. ¿Quieres saber cuál será la próxima actividad?`

            const proxima_actividad = await dynamodbFunciones.getProximaActividad(user.uuid)
              .then((resp) => {
                const actividad = resp;
                outputSpeech = `Hola ${user.nombre}, parece que no tienes actividades pendientes por ahora. La próxima actividad será ${actividad.titulo} a las ${actividad.hora}`
                return actividad;
              })
          }
          else if (actividades_pendientes !== undefined) {

            const replaceEntityDirective = {
              type: 'Dialog.UpdateDynamicEntities',
              updateBehavior: 'REPLACE',
              types: [
                {
                  name: 'actividades',
                  values: dynamicEntityActividades
                }
              ]
            }

            return handlerInput.responseBuilder
              .speak(outputSpeech)
              .addDirective(replaceEntityDirective)
              .reprompt(outputSpeech)
              .getResponse();
          }
        }
      }



      return handlerInput.responseBuilder
        .speak(outputSpeech)
        .getResponse();
    }

  },
};

const ProximaActividadIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && (handlerInput.requestEnvelope.request.intent.name === 'ProximaActividad');
  },
  async handle(handlerInput) {
    let speechText = 'No quedan actividades por hoy';
    const { attributesManager } = handlerInput;
    const requestAttributes = attributesManager.getRequestAttributes();
    const sessionAttributes = attributesManager.getSessionAttributes();

    console.log("Proxima actividad intent");
    const user_uuid = sessionAttributes['user_uuid'];


    const proxima_actividad = await dynamodbFunciones.getProximaActividad(user_uuid)
      .then((resp) => {
        const actividad = resp;
        if (actividad)
          speechText = `La próxima actividad será ${actividad.titulo} a las ${actividad.hora}`
        return actividad;
      })

    return handlerInput.responseBuilder
      .speak(speechText)
      .getResponse();
  },
};

const CompletarActividadIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && (handlerInput.requestEnvelope.request.intent.name === 'CompletarActividad');
  },
  async handle(handlerInput) {
    console.log("he entrado en completar actividad")
    let speechText = 'No he encontrado esa actividad entre tus actividades';
    const { attributesManager } = handlerInput;
    const request = handlerInput.requestEnvelope.request;
    const requestAttributes = attributesManager.getRequestAttributes();
    const sessionAttributes = attributesManager.getSessionAttributes();

    console.log("he entrado en completar actividad222")
    /*
        let slotValues = Alexa.get(request.intent.slots);
    
        console.log(slotValues);*/

    let tituloAct = handlerInput.requestEnvelope.request.intent.slots.actividad.value.toLowerCase();
    console.log("ID de actividad essss: " + JSON.stringify(handlerInput.requestEnvelope.request.intent.slots));
    //let tituloAct = slotValues.actividad.resolved;
    let act_uuid = '';

    handlerInput.requestEnvelope.request.intent.slots.actividad.resolutions.resolutionsPerAuthority.forEach(element => {
      console.log(element);
      if (element.status.code === "ER_SUCCESS_MATCH") {
        act_uuid = element.values[0].value.id;
        tituloAct = element.values[0].value.name;
      }
    });

    let completar_actividad = false;

    if (act_uuid !== '') {
      console.log("ID usuario y ID actividad: " + sessionAttributes['user_uuid'] + ' ' + act_uuid)
      completar_actividad = await dynamodbFunciones.completarActividad(act_uuid, sessionAttributes['user_uuid']);
      speechText = `Has completado la actividad ${tituloAct}`;
    }
    else speechText = "No he podido encontrar la actividad"

    return handlerInput.responseBuilder
      .speak(speechText)
      .getResponse();
  },
};

function getPersistenceAdapter() {
  const { DynamoDbPersistenceAdapter } = require("ask-sdk-dynamodb-persistence-adapter");
  const tableName = 'avidir_persistence';
  return new DynamoDbPersistenceAdapter({
    tableName: tableName,
    createTable: true
  });
}

let persistenceAdapter = getPersistenceAdapter();

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent'
        || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent'
        || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.NoIntent');
  },
  handle(handlerInput) {
    const speechText = 'Hasta luego!';

    return handlerInput.responseBuilder
      .speak(speechText)
      .getResponse();
  },
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error handled: ${error.message}`);

    return handlerInput.responseBuilder
      .speak(`He tenido un error: ${error.message}`)
      .reprompt('Sorry, I can\'t understand the command. Please say again.')
      .getResponse();
  },
};

const LoadAttributesRequestInterceptor = {
  async process(handlerInput) {
    if (handlerInput.requestEnvelope.session['new']) {
      const { attributesManager } = handlerInput;
      const persistentAttributes = await attributesManager.getPersistentAttributes() || {};

      return attributesManager.setSessionAttributes(persistentAttributes);
    }
  }
}

const SaveAttributesResponseInterceptor = {
  async process(handlerInput, response) {
    const { attributesManager } = handlerInput;
    let sessionAttributes = attributesManager.getSessionAttributes();
    const shouldEndSession = (typeof response.shouldEndSession === "undefined" ? true : response.shouldEndSession);
    if (shouldEndSession || handlerInput.requestEnvelope.request.type === 'SessionEndedRequest') {
      attributesManager.setPersistentAttributes(sessionAttributes);
      return await attributesManager.savePersistentAttributes();
    }
  }
}

// Register the handlers and make them ready for use in Lambda
exports.handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(LaunchRequestHandler, CancelAndStopIntentHandler, ProximaActividadIntentHandler, CompletarActividadIntentHandler)
  .addErrorHandlers(ErrorHandler)
  .addRequestInterceptors(LoadAttributesRequestInterceptor)
  .addResponseInterceptors(SaveAttributesResponseInterceptor)
  .withPersistenceAdapter(persistenceAdapter)
  .withApiClient(new Alexa.DefaultApiClient())
  .lambda();

const getRemoteData = function (url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? require('https') : require('http');
    const request = client.get(url, (response) => {
      if (response.statusCode < 200 || response.statusCode > 299) {
        reject(new Error('Failed with status code: ' + response.statusCode));
      }
      const body = [];
      response.on('data', (chunk) => body.push(chunk));
      response.on('end', () => resolve(body.join('')));
    });
    request.on('error', (err) => reject(err))
  })
};
