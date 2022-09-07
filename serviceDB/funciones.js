const AWS = require('aws-sdk');
const { default: axios } = require('axios');
AWS.config.update({
    region: 'eu-west-3'
});

const dynamodb = new AWS.DynamoDB.DocumentClient();
const { batchWriteAll } = require("batch-write-all");
const moment = require('moment-timezone');
const { api_url, api_key } = require('./api');

const userTable = 'UsersAvidir';
const actividadesTable = 'ActividadesAvidir';
const actividadesTableLogs = 'ActividadesAvidirLogs';
const actividadesRemindersTable = 'ActividadesRemindersLogs'

function getWeekdayChar(weekday) {
    let weekdayChar = null;

    switch (weekday) {
        case 0:
            weekdayChar = "D";
            break;
        case 1:
            weekdayChar = "L";
            break;
        case 2:
            weekdayChar = "M";
            break;
        case 3:
            weekdayChar = "X";
            break;
        case 4:
            weekdayChar = "J";
            break;
        case 5:
            weekdayChar = "V";
            break;
        case 6:
            weekdayChar = "S";
            break;
        default:
            break;
    }

    return weekdayChar;
}

function getWeekdayCharReminder(weekday) {
    let weekdayChar = null;

    switch (weekday) {
        case "D":
            weekdayChar = "SU";
            break;
        case "L":
            weekdayChar = "MO";
            break;
        case "M":
            weekdayChar = "TU";
            break;
        case "X":
            weekdayChar = "WE";
            break;
        case "J":
            weekdayChar = "TH";
            break;
        case "V":
            weekdayChar = "FR";
            break;
        case "S":
            weekdayChar = "SA";
            break;
        default:
            break;
    }

    return weekdayChar;
}

async function getUserbyEmail(email) {

    const params = {
        ExpressionAttributeValues: {
            ':email': email
        },
        FilterExpression: 'email_alexa = :email',
        TableName: userTable
    };

    return await dynamodb.scan(params).promise().then(response => {
        console.log(response);
        console.log(response.Items[0])
        return response.Items[0];
    }, error => {
        console.error("Error al obtener los usuarios: ", error)
    }
    )
}

async function getActividadesByUserID(user_uuid) {
    const userUuid = user_uuid;

    const params = {
        ExpressionAttributeValues: {
            ':userUuidSearch': userUuid
        },
        FilterExpression: 'userUuid = :userUuidSearch',
        TableName: actividadesTable
    };

    const actividades = await dynamodb.scan(params).promise().then(response => {
        return response.Items;
    }, error => {
        console.error("Error al obtener las actividades para este usuario: ", error);
    })

    return actividades;
}

async function getTodasActividadesHoy(user_uuid) {
    const userUuid = user_uuid;

    let date_begin = new Date();
    date_begin.setHours(0, 0, 0, 0);
    let date_end = new Date();
    date_end.setHours(0, 0, 0, 0);
    const today_begin = date_begin;
    const today_end = date_end;
    const today_weekday = getWeekdayChar(date_begin.getDay());

    const params = {
        ExpressionAttributeValues: {
            ':userUuidSearch': userUuid,
            ':semanalmente': "Semanalmente",
            ':unavez': "Una sola vez",
            ':diariamente': "Diariamente",
            ':todayBegin': today_begin.getTime(),
            ':todayEnd': today_end.getTime(),
            ':weekdayToday': today_weekday

        },
        FilterExpression: 'userUuid = :userUuidSearch AND ((repeticionSelected = :unavez AND fechaUnaVez >= :todayBegin AND fechaUnaVez <= :todayEnd) OR (repeticionSelected = :diariamente) OR (repeticionSelected = :semanalmente AND contains(repeticionSemana, :weekdayToday)))',
        TableName: actividadesTable
    };

    const actividadesShow = await dynamodb.scan(params).promise().then(response => {
        return response.Items;
    }, error => {
        console.error("Error al obtener las actividades para este usuario: ", error);
    })

    return actividadesShow;
}

async function getActividadesHoyCompletadas(user_uuid) {
    const userUuid = user_uuid;
    let date = new Date();
    date.setHours(0, 0, 0, 0);


    const params = {
        ExpressionAttributeValues: {
            ':todayMidnight': date.getTime(),
            ':uuidUserSearch': userUuid
        },
        ExpressionAttributeNames: { "#timestampMS": "timestampMS", '#uuidUser': "uuidUser" },
        FilterExpression: '#timestampMS >= :todayMidnight AND #uuidUser = :uuidUserSearch',
        TableName: actividadesTableLogs
    };

    const actividades = await dynamodb.scan(params).promise().then(response => {
        console.log("Actividades completadas son: " + JSON.stringify(response.Items));
        return response.Items;
    }, error => {
        console.error("Error al obtener las actividades completadas para este usuario: ", error);
    })

    return actividades;
}

async function getActividadesHoyPendientes(user_uuid) {
    const userUuid = user_uuid;

    const actividades_hoy = await getTodasActividadesHoy(userUuid);
    const actividades_completadas = await getActividadesHoyCompletadas(userUuid);
    let date = new Date();
    let time_string_now = `${(date.getHours() + 2) % 24}:${date.getMinutes()}`;


    let completadas_ids = actividades_completadas.map(act => {
        return act.uuidActividad;
    })

    console.log("Actividades completadas hoy: " + JSON.stringify(actividades_completadas))

    let actividades_pendientes = [];

    actividades_hoy.map(act => {

        console.log(act.titulo + " " + act.hora + "< " + time_string_now + " " + timeLessThan(act.hora, time_string_now));
        if (!completadas_ids.includes(act.uuid) && timeLessThan(act.hora, time_string_now))
            actividades_pendientes.push(act);
    })

    console.log(JSON.stringify(actividades_pendientes));

    return actividades_pendientes;
}

function timeLessThan(time1, time2) {
    let time1S = time1.split(":");
    let time2S = time2.split(":");

    console.log(parseInt(time1S[0]) + "< " + parseInt(time2S[0]));
    console.log(parseInt(time1S[1]) + "< " + parseInt(time2S[1]));

    if (parseInt(time1S[0]) < parseInt(time2S[0])) {
        return true;
    }
    else if ((parseInt(time1S[0]) == parseInt(time2S[0])) && (parseInt(time1S[1]) < parseInt(time2S[1]))) {
        return true;
    }
    else return false;
}

Array.prototype.hasMin = function (attrib) {
    return (this.length && this.reduce(function (prev, curr) {
        return timeLessThan(prev[attrib], curr[attrib]) ? prev : curr;
    })) || null;
}

async function getProximaActividad(user_uuid) {
    const userUuid = user_uuid;
    let date = new Date();

    let time_string_now = `${(date.getHours() + 2) % 24}:${date.getMinutes()}`;

    const actividades_hoy = await getTodasActividadesHoy(userUuid);

    let actividades_proximas = [];

    actividades_hoy.map(act => {
        if (timeLessThan(time_string_now, act.hora)) {
            actividades_proximas.push(act);
        }
    })

    console.log("Actividades proximas + " + JSON.stringify(actividades_proximas));

    const proxima_actividad = actividades_proximas.hasMin('hora');
    console.log(proxima_actividad)

    return proxima_actividad;

}

async function completarActividad(act_uuid, user_uuid) {
    /*const taskUuid = act_uuid;
    const userUuid = user_uuid;

    let date = new Date();
    const timestamp = date.toJSON();
    const timestampMS = date.getTime();

    const taskCompleted = {
        idTimestamp: timestamp,
        uuidActividad: taskUuid,
        uuidUser: userUuid,
        timestampMS: timestampMS
    }

    const params = {
        TableName: actividadesTableLogs,
        Item: taskCompleted
    }

    const actividadCompletada = await dynamodb.put(params).promise().then(() => {
        return true;
    }, error => {
        console.error('Hubo un error al completar la actividad: ', error)
    });


    //

    if (!actividadCompletada) {
        return false
    }
    return actividadCompletada;*/

    const params = {
        TableName: actividadesTable,
        Key: {
            uuid: act_uuid,
            userUuid: user_uuid
        }
    }


    const actividad = await dynamodb.get(params).promise().then(response => {
        return response.Item;
    }, error => {
        console.error("Error al obtener la actividad: ", error)
    }
    )

    const requestBody = actividad
    const requestConfig = {
        headers: {
            'x-api-key': api_key
        }
    }

    const completarActividadURL = api_url + '/completar-actividad';

    let actividadCompletada= false;

    axios.post(completarActividadURL, requestBody, requestConfig).then(response => {
        actividadCompletada = true;

    }).catch(error => {
        if (error.response.status === 401) {
            console.log(error.response.data.message);
        }
        else {
            console.log('El servidor no está disponible. Inténtelo de nuevo más tarde');
        }

        return false;
    })

    console.log("ACTIVIDAD COMPLETADA: " + actividadCompletada)

    return actividadCompletada;


}

async function crearNotificacionAlCompletarActividad(act) {
    let notificaciones = [];
    const notificacionesHoy = await getAllNotificacionesUUIDsHoy();
    let date = new Date();
    let time_string_now = `${(date.getHours() + 2) % 24}:${date.getMinutes()}`;
    let month_date = date.getMonth() + 1;
    if (month_date < 10) month_date = "0" + month_date;
    let day_date = date.getDate();
    if (day_date < 10) day_date = "0" + day_date;
    let date_hoy = `${date.getFullYear()}${month_date}${day_date}`;
    act.cuidadores_uuid.map(cuidador => {
        if (act.notifCCompletar && !notificacionesHoy.includes(act.uuid + date_hoy + cuidador + "CCompletada")) {

            let notif = {
                uuid_notificacion: act.uuid + date_hoy + cuidador + "CCompletada",
                tipo: "CCompletada",
                uuid_actividad: act.uuid,
                uuid_user: cuidador,
                texto: `El usuario ${act.userUuid} ha completado la actividad ${act.titulo}`,
                leida: false,
                fecha: date_hoy,
                uuid_usuarioACargo: act.userUuid
            }

            notificaciones.push(notif);
        }
    })

    let items = notificaciones.map(notif => ({
        PutRequest: {
            Item: notif
        }
    }));

    let params = {
        RequestItems: {
            [notificacionesTable]: items
        }
    };

    //console.log("Notificaciones al completar a crear: " + JSON.stringify(notificaciones));
    batchWriteAll(dynamodb, params).promise()// <-- this is with using promise()
        .then(res => console.log('results  are', res))
        .catch(err => console.log('Error  are', err))
}



async function deleteReminders(remindersArray) {
    let items = remindersArray.map(reminder => ({
        DeleteRequest: {
            Key: reminder.alertToken
        }
    }))

    let params = {
        RequestItems: {
            [actividadesRemindersTable]: items
        }
    }

    return batchWriteAll(dynamodb, params).promise()// <-- this is with using promise()
        .then(res => {
            console.log('results  are', res)
            return true;
        })
        .catch(err => {
            console.log('Error  are', err)
            return false;
        })
}

async function getRemindersByUserID(user_uuid) {
    const userUuid = user_uuid;

    const params = {
        ExpressionAttributeValues: {
            ':userUuidSearch': userUuid
        },
        FilterExpression: 'uuid_user = :userUuidSearch',
        TableName: actividadesRemindersTable
    };

    const reminders = await dynamodb.scan(params).promise().then(response => {
        return response.Items;
    }, error => {
        console.error("Error al obtener las actividades para este usuario: ", error);
    })

    return reminders;
}

function crearReminderObj(actividad) {

    let locale = 'es-ES';
    let timezone = 'Europe/Madrid';

    const now = moment().tz(timezone);

    let reminder = {};

    if (actividad.repeticionSelected === "Una sola vez") {
        let time = moment(actividad.hora, 'HH:mm');
        let scheduledTime = moment(actividad.fechaUnaVez).tz(timezone).set({
            hour: time.get('hour'),
            minute: time.get('minute')
        });

        console.log("REMINDER OBJ ACTIVIDAD FECHA UNA VEZ")
        if (!scheduledTime.isBefore(now)) {

            reminder = {
                requestTime: now.format('YYYY-MM-DDTHH:mm:00.000'),
                trigger: {
                    type: 'SCHEDULED_ABSOLUTE',
                    scheduledTime: scheduledTime.format('YYYY-MM-DDTHH:mm:00.000'),
                    timeZoneId: timezone,
                },
                alertInfo: {
                    spokenInfo: {
                        content: [{
                            locale: locale,
                            text: `Comienza la actividad ${actividad.titulo}, deberías completarla en ${actividad.tiempo_completar} minutos`,
                        }],
                    },
                },
                pushNotification: {
                    status: 'ENABLED',
                }
            }
        }

        console.log("REMINDER OBJ ACTIVIDAD FECHA UNA VEZ CREADOOOO")
    }

    if (actividad.repeticionSelected === "Diariamente") {
        let time = moment(actividad.hora, 'HH:mm');
        const now2 = moment().tz(timezone);
        let scheduledTime = now2.set({
            hour: time.get('hour'),
            minute: time.get('minute'),
            second: 0
        });

        if (scheduledTime.isBefore(now)) scheduledTime = scheduledTime.add(1, 'days')
        console.log("REMINDER OBJ ACTIVIDAD DIARIA")

        reminder = {
            requestTime: now.format('YYYY-MM-DDTHH:mm:00.000'),
            trigger: {
                type: 'SCHEDULED_ABSOLUTE',
                scheduledTime: scheduledTime.format('YYYY-MM-DDTHH:mm:00.000'),
                timeZoneId: timezone,
                recurrence: {
                    startDateTime: scheduledTime.format('YYYY-MM-DDTHH:mm:00.000'),
                    endDateTime: scheduledTime.add(10, "days").format('YYYY-MM-DDTHH:mm:00.000'),
                    recurrenceRules: [
                        `FREQ=DAILY;BYHOUR=${time.get('hour')};BYMINUTE=${time.get('minute')};BYSECOND=0;INTERVAL=1;`
                    ]
                }
            },
            alertInfo: {
                spokenInfo: {
                    content: [{
                        locale: locale,
                        text: `Comienza la actividad ${actividad.titulo}, deberías completarla en ${actividad.tiempo_completar} minutos`,
                    }],
                },
            },
            pushNotification: {
                status: 'ENABLED',
            }
        }
    }

    if (actividad.repeticionSelected === 'Semanalmente') {
        let time = moment(actividad.hora, 'HH:mm');
        const now2 = moment().tz(timezone);
        let scheduledTime = now2.set({
            hour: time.get('hour'),
            minute: time.get('minute')
        });

        if (scheduledTime.isBefore(now)) scheduledTime = scheduledTime.add(1, 'days')

        let string_weekdays = '';
        let array_days = actividad.repeticionSemana.map(dia => {
            string_weekdays += getWeekdayCharReminder(dia) + ',';
            return getWeekdayCharReminder(dia)
        });

        let string_recurrence = string_weekdays.slice(0, -1);

        console.log("REMINDER OBJ ACTIVIDAD SEMANAL")


        reminder = {
            requestTime: now.format('YYYY-MM-DDTHH:mm:00.000'),
            trigger: {
                type: 'SCHEDULED_ABSOLUTE',
                scheduledTime: scheduledTime.format('YYYY-MM-DDTHH:mm:00.000'),
                timeZoneId: timezone,
                recurrence: {
                    startDateTime: scheduledTime.format('YYYY-MM-DDTHH:mm:00.000'),
                    endDateTime: scheduledTime.add(10, "days").format('YYYY-MM-DDTHH:mm:00.000'),
                    recurrenceRules: [
                        `FREQ=WEEKLY;BYHOUR=${time.get('hour')};BYMINUTE=${time.get('minute')};BYSECOND=0;INTERVAL=1;WKST=MO;BYDAY=${string_recurrence}`
                    ]
                }
            },
            alertInfo: {
                spokenInfo: {
                    content: [{
                        locale: locale,
                        text: `Comienza la actividad ${actividad.titulo}, deberías completarla en ${actividad.tiempo_completar} minutos`,
                    }],
                },
            },
            pushNotification: {
                status: 'ENABLED',
            }
        }
    }

    return reminder;
}

module.exports = { getUserbyEmail, getTodasActividadesHoy, getActividadesHoyPendientes, getProximaActividad, completarActividad, deleteReminders, getActividadesByUserID, getRemindersByUserID, crearReminderObj }