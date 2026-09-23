import axios from 'axios';

/* ============================================================================
 *  API-СЕРВИС ДЛЯ РАБОТЫ С GREEN-API (мессенджер Telegram)
 * ============================================================================
 *
 *  Это ЕДИНСТВЕННЫЙ модуль приложения, который общается с сервером GREEN-API.
 *  Компоненты React не знают ничего про HTTP-запросы: они вызывают готовые
 *  функции и получают уже разобранный, типизированный результат.
 *
 *  Документация GREEN-API для Telegram: https://green-api.com/telegram/docs/
 *
 *  Используются следующие методы:
 *    1. getStateInstance    — узнать состояние инстанса при входе;
 *    2. setSettings         — настроить инстанс для работы по HTTP API (long-poll);
 *    3. sendMessage         — отправка текстового сообщения;
 *    4. checkAccount        — сервисный метод: узнать внутренний chatId по номеру;
 *    5. receiveNotification — получение одного входящего уведомления (HTTP API);
 *    6. deleteNotification  — подтверждение обработки уведомления (его удаление).
 *
 *  Схема получения сообщений по технологии HTTP API:
 *    а) приложение вызывает receiveNotification и получает ОДНО уведомление
 *       (если очередь пуста — сервер отвечает телом "null");
 *    б) приложение обрабатывает уведомление и ОБЯЗАТЕЛЬНО вызывает
 *       deleteNotification с его receiptId, чтобы уведомление не выдавалось
 *       повторно.
 * ============================================================================ */

/**
 * Резервный адрес API. Используется только если по idInstance не удалось
 * определить адрес (нестандартный номер инстанса) и пользователь не указал
 * apiUrl вручную.
 */
const GREEN_API_FALLBACK_URL = 'https://api.green-api.com';

/**
 * АДРЕС API (apiUrl) ЗАВИСИТ ОТ НОМЕРА ИНСТАНСА — это частая причина ошибки 401.
 *
 * GREEN-API разводит инстансы по разным хостам, чтобы распределить нагрузку.
 * В официальном SDK (green-api/telegram-api-client-python) адрес по умолчанию
 * задан как «https://4100.api.green-api.com», то есть первые четыре цифры
 * idInstance — это и есть поддомен.
 *
 * Примеры:
 *   idInstance = 4100123456 → https://4100.api.green-api.com
 *   idInstance = 1101123456 → https://1101.api.green-api.com
 *
 * Если пользователь вручную указал apiUrl (он выдаётся в личном кабинете),
 * используем именно его — это самый надёжный вариант.
 *
 * @param idInstance - номер инстанса из личного кабинета.
 * @param customApiUrl - адрес API, указанный пользователем (необязательно).
 * @returns адрес хоста API без завершающего слэша.
 */
export const resolveApiUrl = (idInstance: string, customApiUrl?: string): string => {
  // 1. Если пользователь указал адрес вручную — доверяем ему.
  if (customApiUrl && customApiUrl.trim()) {
    return customApiUrl.trim().replace(/\/+$/, '');
  }

  const trimmed = idInstance.trim();

  // 2. Строим адрес из первых четырёх цифр номера инстанса.
  //    Реальные номера инстансов — от 8 до 12 цифр (например,
  //    4100123456 или 412345678912): поддомен всегда первые 4 цифры,
  //    412345678912 → https://4100.api.green-api.com.
  //    Если ввести короткое значение (например, "11223"), поддомен
  //    вроде "1122.api.green-api.com" вернёт непонятную ошибку 404 —
  //    в таком случае лучше обратиться к общему хосту.
  if (/^\d{8,14}$/.test(trimmed)) {
    return `https://${trimmed.slice(0, 4)}.api.green-api.com`;
  }

  // 3. Нестандартный или неполный номер инстанса — используем общий адрес.
  return GREEN_API_FALLBACK_URL;
};

/**
 * Суффикс, который GREEN-API ожидает в chatId при отправке по номеру телефона.
 * Формат «номер@c.us» поддерживается для обратной совместимости, чтобы
 * не заставлять разработчика сначала искать внутренний числовой chatId.
 */
const PHONE_CHAT_SUFFIX = '@c.us';

/**
 * Экземпляр axios с общими настройками.
 * timeout=10 000 мс: если сервер не ответил за 10 секунд, запрос прерывается,
 * чтобы интерфейс не «завис» навсегда.
 *
 * Обратите внимание: baseURL здесь НЕ задан специально — адрес API зависит от
 * номера инстанса, поэтому полный адрес собирается функцией buildRequestUrl().
 */
const api = axios.create({
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Собирает полный адрес запроса к GREEN-API для конкретного метода.
 *
 * Схема адреса одинакова для всех методов:
 *   {apiUrl}/waInstance{idInstance}/{метод}/{apiTokenInstance}
 *
 * Префикс «waInstance» сохраняется и в Telegram-версии — это наследие
 * WhatsApp-версии API, и это не ошибка.
 *
 * @param credentials - учётные данные (idInstance, apiTokenInstance, apiUrl).
 * @param method - имя метода GREEN-API, например 'sendMessage'.
 * @returns полный URL запроса.
 */
const buildRequestUrl = (credentials: ChatCredentials, method: string): string =>
  `${resolveApiUrl(credentials.idInstance, credentials.apiUrl)}` +
  `/waInstance${credentials.idInstance}/${method}/${credentials.apiTokenInstance}`;

/**
 * Перехватчик ответов: логируем любые ошибки запросов в консоль разработчика.
 * Текст ошибки также пробрасывается дальше (Promise.reject), чтобы вызвавшая
 * функция могла показать пользователю понятное сообщение.
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('[GREEN-API] Ошибка запроса:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

/**
 * Учётные данные для подключения к GREEN-API.
 * Пользователь берёт их в своём личном кабинете GREEN-API.
 *
 * @property idInstance       - идентификатор инстанса (например, "4100123456");
 * @property apiTokenInstance - токен доступа к инстансу (длинная строка);
 * @property apiUrl           - адрес API (необязательно). Выдаётся в личном
 *                              кабинете. Если не указан, адрес вычисляется
 *                              автоматически из первых четырёх цифр idInstance.
 */
export interface ChatCredentials {
  idInstance: string;
  apiTokenInstance: string;
  apiUrl?: string;
}

/**
 * Данные о собеседнике/чате внутри уведомления GREEN-API.
 * Все поля, кроме chatId, могут отсутствовать — поэтому они опциональны.
 */
export interface GreenApiSenderData {
  /** Внутренний идентификатор чата: "10000000" для пользователя, "-1000..." для группы. */
  chatId: string;
  /** Тип чата: "user" (личный) или "group"/"supergroup" (групповой). */
  chatType?: string;
  /** Идентификатор отправителя (совпадает с chatId в личных чатах). */
  sender?: string;
  /** Название чата — то, что показываем в заголовке окна. */
  chatName?: string;
  /** Имя отправителя. */
  senderName?: string;
  /** Тип отправителя (обычно "user"). */
  senderType?: string;
  /** Номер телефона отправителя (только цифры, без «+»). */
  senderPhoneNumber?: number;
}

/**
 * Объект с собственно содержимым сообщения.
 * Поле typeMessage определяет, какой вложенный объект заполнен.
 * Мы поддерживаем только текстовые сообщения (typeMessage === 'textMessage').
 */
export interface GreenApiMessageData {
  /** Тип сообщения: textMessage, imageMessage, videoMessage и т.д. */
  typeMessage: string;
  /** Данные текстового сообщения (заполнено только для textMessage). */
  textMessageData?: {
    /** Сам текст сообщения. */
    textMessage: string;
    /** Переслано ли сообщение (true / false). */
    isForwarded?: boolean;
    /** Сколько раз сообщение было переслано. */
    forwardingScore?: number;
  };
}

/**
 * Тело уведомления (внутренний объект body из ответа receiveNotification).
 * Именно здесь лежит информация о полученном сообщении.
 */
export interface GreenApiNotification {
  /**
   * Тип уведомления. Нас интересуют:
   *  - 'incomingMessageReceived'    — входящее сообщение (показываем в чате);
   *  - 'outgoingMessageReceived'    — сообщение отправлено с телефона;
   *  - 'outgoingAPIMessageReceived' — сообщение отправлено через API
   *                                    (по нему появляется вторая галочка ✓✓).
   */
  typeWebhook: string;
  /** Unix-время получения сообщения в секундах. */
  timestamp: number;
  /** Уникальный идентификатор сообщения (используем для защиты от дублей). */
  idMessage: string;
  /** Данные о собеседнике и чате. */
  senderData?: GreenApiSenderData;
  /** Содержимое сообщения. */
  messageData?: GreenApiMessageData;
}

/**
 * Ответ метода receiveNotification.
 * Если очередь уведомлений пуста, сервер возвращает строку "null",
 * и функция receiveNotification() вернёт null.
 */
export interface ReceiveNotificationResponse {
  /** Идентификатор уведомления, который нужно передать в deleteNotification. */
  receiptId: number;
  /** Тело уведомления с данными о сообщении. */
  body: GreenApiNotification;
}

/**
 * Возможные состояния инстанса (поле stateInstance в ответе GetStateInstance).
 * Основные значения перечислены отдельно, но тип открыт (| string),
 * так как сервер может добавить новое состояние.
 *
 *  - notAuthorized — инстанс создан, но к Telegram ещё не подключён (QR не отсканирован);
 *  - starting      — инстанс запускается (может занимать до 5 минут);
 *  - authorized    — всё готово, можно отправлять и получать сообщения;
 *  - blocked       — инстанс заблокирован;
 *  - suspended     — приостановлен за нарушение правил;
 *  - sleeping      — аккаунт неактивен, «просыпается» при первом запросе;
 *  - yellowCard    — работа ограничена из-за жалоб.
 */
export type InstanceState =
  | 'notAuthorized'
  | 'starting'
  | 'authorized'
  | 'blocked'
  | 'suspended'
  | 'sleeping'
  | 'yellowCard'
  | string;

/**
 * Ответ метода GetStateInstance.
 */
export interface GetStateInstanceResponse {
  /** Текущее состояние инстанса. */
  stateInstance: InstanceState;
}

/**
 * Ответ метода sendMessage — сервер возвращает идентификатор отправленного
 * сообщения. Мы используем его как id сообщения в интерфейсе.
 */
export interface SendMessageResponse {
  /** Идентификатор отправленного сообщения. */
  idMessage: string;
}

/**
 * Ответ метода setSettings — сервер возвращает признак успешного сохранения.
 */
export interface SetSettingsResponse {
  /** true — настройки сохранены. */
  saveSettings: boolean;
}

/**
 * Ответ сервисного метода checkAccount — проверка наличия аккаунта Telegram
 * по номеру телефона. Возвращает внутренний chatId, который рекомендуется
 * использовать при отправке сообщений.
 */
export interface CheckAccountResponse {
  /** Существует ли аккаунт Telegram с таким номером. */
  exist: boolean;
  /** Внутренний идентификатор чата — то, что нужно передавать в sendMessage. */
  chatId: string;
  /** Имя пользователя в Telegram (@username), если доступно. */
  username?: string;
  /** Номер телефона, который проверяли. */
  phoneNumber?: number;
  /** Взят ли результат из кэша сервера. */
  fromCache?: boolean;
}

/* ---------------------------------------------------------------------------
 *  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
 * ------------------------------------------------------------------------- */

/**
 * Приводит номер телефона к «чистому» виду: только цифры.
 * Пользователь может ввести номер как угодно («+7 999 123-45-67»,
 * «8 (999) 1234567»), а API принимает только цифры.
 *
 * @param phoneNumber - номер в произвольном формате.
 * @returns строка, содержащая только цифры (например, "79991234567").
 */
export const normalizePhoneNumber = (phoneNumber: string): string =>
  phoneNumber.replace(/\D/g, '');

/**
 * Формирует значение chatId для отправки сообщения по номеру телефона.
 * GREEN-API для Telegram принимает номер в формате «79991234567@c.us».
 *
 * @param phoneNumber - номер телефона (любой формат).
 * @returns chatId вида "79991234567@c.us".
 */
export const buildChatId = (phoneNumber: string): string =>
  `${normalizePhoneNumber(phoneNumber)}${PHONE_CHAT_SUFFIX}`;

/**
 * Достаёт из ошибки axios понятный пользователю текст.
 * Сервер GREEN-API возвращает ошибки в виде { code, message } либо просто
 * строкой, поэтому пробуем прочитать разные варианты.
 *
 * @param error - ошибка, пойманная в try/catch.
 * @returns человекочитаемое описание ошибки.
 */
const HTTP_STATUS_HINTS: Record<number, string> = {
  400: 'Сервер отклонил запрос. Проверьте формат номера телефона.',
  401: 'Неверный apiTokenInstance. Скопируйте токен из личного кабинета GREEN-API ещё раз.',
  403: 'Неверный idInstance. Проверьте номер инстанса в личном кабинете GREEN-API.',
  404: 'Метод не найден. Проверьте idInstance и адрес запроса.',
  429: 'Слишком много запросов. Подождите немного и попробуйте снова.',
};

export const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    const status = error.response?.status;

    // Ошибки авторизации объясняем своими словами: сервер отвечает коротким
    // английским словом «Unauthorized», что не помогает пользователю.
    if (status === 401 || status === 403) {
      return `Ошибка ${status}. ${HTTP_STATUS_HINTS[status]}`;
    }

    // В остальных случаях сначала показываем официальное сообщение GREEN-API.
    if (data && typeof data === 'object' && 'message' in data) {
      return String((data as { message: unknown }).message);
    }
    if (typeof data === 'string' && data.trim()) {
      return data;
    }

    // Сервер ответил ошибкой, но без пояснения — используем подсказку по коду.
    // Например, 401 почти всегда означает «не тот apiTokenInstance».
    if (status && HTTP_STATUS_HINTS[status]) {
      return `Ошибка ${status}. ${HTTP_STATUS_HINTS[status]}`;
    }
    if (status && status >= 500) {
      return `Ошибка ${status}. Сервер GREEN-API временно недоступен, повторите запрос позже.`;
    }
    if (status) {
      return `Ошибка сервера GREEN-API (код ${status}).`;
    }

    // Ответа нет вовсе: нет интернета, запрос заблокирован или истёк таймаут.
    if (error.code === 'ECONNABORTED') {
      return 'Превышено время ожидания ответа от GREEN-API. Проверьте интернет-соединение.';
    }
    return 'Не удалось соединиться с GREEN-API. Проверьте интернет-соединение.';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Неизвестная ошибка';
};

/* ---------------------------------------------------------------------------
 *  ОСНОВНЫЕ МЕТОДЫ GREEN-API
 * ------------------------------------------------------------------------- */

/**
 * ПОЛУЧЕНИЕ СОСТОЯНИЯ ИНСТАНСА (метод GetStateInstance).
 *
 * HTTP: GET {apiUrl}/waInstance{idInstance}/getStateInstance/{apiTokenInstance}
 * Ответ: { "stateInstance": "authorized" }
 *
 * Используется при входе: так пользователь сразу узнаёт, что токен неверный
 * или что инстанс ещё не подключён к Telegram, а не после попытки отправить
 * сообщение.
 *
 * @param credentials - учётные данные GREEN-API.
 * @returns текущее состояние инстанса строкой.
 */
export const getStateInstance = async (
  credentials: ChatCredentials
): Promise<InstanceState> => {
  const url = buildRequestUrl(credentials, 'getStateInstance');

  const response = await api.get<GetStateInstanceResponse>(url);

  return response.data?.stateInstance;
};

/**
 * Переводит техническое состояние инстанса на понятный пользователю язык.
 *
 * @param state - значение поля stateInstance.
 * @returns описание состояния на русском языке.
 */
export const describeInstanceState = (state: InstanceState): string => {
  switch (state) {
    case 'authorized':
      // Нормальное рабочее состояние: можно отправлять и получать сообщения.
      return 'Инстанс авторизован и готов к работе.';
    case 'notAuthorized':
      return (
        'Инстанс не авторизован. Откройте личный кабинет GREEN-API, выберите этот ' +
        'инстанс, нажмите «Получить QR» и отсканируйте код в приложении Telegram ' +
        '(Настройки → Устройства → Подключить устройство).'
      );
    case 'starting':
      return 'Инстанс запускается. Подождите около минуты и войдите снова.';
    case 'blocked':
      return 'Инстанс заблокирован. Обратитесь в поддержку GREEN-API: support@green-api.com';
    case 'suspended':
      return 'Инстанс приостановлен за нарушение правил. Обратитесь в поддержку GREEN-API.';
    case 'sleeping':
      return 'Аккаунт неактивен. Отправьте любой запрос, чтобы «разбудить» инстанс, и войдите снова.';
    case 'yellowCard':
      return 'Работа инстанса ограничена из-за жалоб. Обратитесь в поддержку GREEN-API.';
    default:
      return `Инстанс пока не готов к работе (состояние: ${state}).`;
  }
};

/**
 * НАСТРОЙКА ИНСТАНСА ПЕРЕД РАБОТОЙ ПО HTTP API (метод SetSettings).
 *
 * HTTP: POST {apiUrl}/waInstance{idInstance}/setSettings/{apiTokenInstance}
 * Ответ: { "saveSettings": true }
 *
 * Зачем это нужно перед началом опроса receiveNotification:
 *   1) Если у инстанса настроен webhookUrl, уведомления уходят на внешний
 *      сервер и в очередь long-poll НЕ попадают — receiveNotification будет
 *      всегда возвращать null. Поэтому сначала очищаем webhookUrl.
 *   2) Нужно включить уведомления, которые мы обрабатываем:
 *        - incomingWebhook            — входящие сообщения;
 *        - outgoingWebhook            — исходящие, отправленные с телефона;
 *        - outgoingMessageWebhook     — исходящие сообщения (webhook);
 *        - outgoingAPIMessageWebhook  — подтверждение доставки наших
 *                                       сообщений, отправленных через API
 *                                       (по нему появляется вторая галочка ✓✓);
 *        - stateWebhook               — изменения состояния инстанса.
 *
 * Ошибка здесь не критична: инстанс мог быть настроен пользователем ранее.
 * Поэтому в handleAuthSubmit вызов обёрнут в try/catch.
 *
 * @param credentials - учётные данные GREEN-API.
 * @returns ответ сервера (обычно { saveSettings: true }).
 */
export const setSettings = async (
  credentials: ChatCredentials
): Promise<SetSettingsResponse> => {
  const url = buildRequestUrl(credentials, 'setSettings');

  const body = {
    // Строго 4 поля из документации технологии HTTP API
    // (https://green-api.com/v3/docs/api/receiving/technology-http-api/).
    // Лишние поля не отправляем: незнакомые поля сервер может отклонять,
    // а ошибка setSettings = очередь уведомлений не настроена и
    // receiveNotification всегда будет возвращать null.
    webhookUrl: '',
    outgoingWebhook: 'yes',
    stateWebhook: 'yes',
    incomingWebhook: 'yes',
  };

  const response = await api.post<SetSettingsResponse>(url, body);

  return response.data;
};

/**
 * ОТПРАВКА ТЕКСТОВОГО СООБЩЕНИЯ (метод SendMessage).
 *
 * HTTP: POST {apiUrl}/waInstance{idInstance}/sendMessage/{apiTokenInstance}
 * Тело запроса: { "chatId": "<кому>", "message": "<текст>" }
 *
 * @param credentials - учётные данные GREEN-API.
 * @param chatId      - идентификатор получателя: либо числовой chatId
 *                      (например, "10000000"), либо "79991234567@c.us".
 * @param message     - текст сообщения.
 * @returns ответ сервера с idMessage отправленного сообщения.
 */
export const sendMessage = async (
  credentials: ChatCredentials,
  chatId: string,
  message: string
): Promise<SendMessageResponse> => {
  const url = buildRequestUrl(credentials, 'sendMessage');

  const response = await api.post<SendMessageResponse>(url, { chatId, message });

  return response.data;
};

/**
 * ПРОВЕРКА НАЛИЧИЯ АККАУНТА И ПОЛУЧЕНИЕ chatId (сервисный метод CheckAccount).
 *
 * HTTP: POST {apiUrl}/waInstance{idInstance}/checkAccount/{apiTokenInstance}
 * Тело запроса: { "phoneNumber": 79991234567 }
 *
 * Зачем это нужно: документация GREEN-API рекомендует отправлять сообщения
 * именно по внутреннему chatId, а не по номеру телефона. Кроме того, метод
 * сразу сообщает, зарегистрирован ли такой номер в Telegram (поле exist).
 *
 * @param credentials - учётные данные GREEN-API.
 * @param phoneNumber - номер телефона (любой формат, приведём к цифрам).
 * @returns данные чата: exist и chatId.
 */
export const checkAccount = async (
  credentials: ChatCredentials,
  phoneNumber: string
): Promise<CheckAccountResponse> => {
  const url = buildRequestUrl(credentials, 'checkAccount');

  // API ожидает номер телефона числом, поэтому преобразуем строку в число.
  const response = await api.post<CheckAccountResponse>(url, {
    phoneNumber: Number(normalizePhoneNumber(phoneNumber)),
  });

  return response.data;
};

/**
 * ПОЛУЧЕНИЕ ОДНОГО ВХОДЯЩЕГО УВЕДОМЛЕНИЯ (метод ReceiveNotification).
 *
 * HTTP: GET {apiUrl}/waInstance{idInstance}/receiveNotification/{apiTokenInstance}
 *
 * Если очередь уведомлений пуста, сервер возвращает строку "null" —
 * в этом случае функция вернёт null, и это нормальная ситуация.
 *
 * ВАЖНО: после обработки уведомление нужно удалить методом deleteNotification,
 * иначе сервер будет отдавать его снова и снова.
 *
 * @param credentials - учётные данные GREEN-API.
 * @returns уведомление с полем receiptId и телом body, либо null.
 */
export const receiveNotification = async (
  credentials: ChatCredentials
): Promise<ReceiveNotificationResponse | null> => {
  const url = buildRequestUrl(credentials, 'receiveNotification');

  // long-poll: сервер держит соединение, пока не придёт уведомление или
  // не истечёт его внутренний таймаут. Общий timeout=10000 мс для этого
  // метода МАЛ — axios обрывал запрос («timeout of 10000ms exceeded» в консоли).
  // Для long-poll ставим 60 секунд.
  const response = await api.get<ReceiveNotificationResponse | string | null>(url, {
    timeout: 60000,
  });
  const data = response.data;

  // Пустая очередь: сервер вернул "null" или пустое тело — новых сообщений нет.
  if (!data || data === 'null' || typeof data === 'string') {
    return null;
  }

  // Проверяем, что структура похожа на уведомление (есть receiptId и body).
  if (typeof data.receiptId !== 'number' || !data.body) {
    return null;
  }

  return data;
};

/**
 * УДАЛЕНИЕ (ПОДТВЕРЖДЕНИЕ) УВЕДОМЛЕНИЯ (метод DeleteNotification).
 *
 * HTTP: DELETE {apiUrl}/waInstance{idInstance}/deleteNotification/{apiTokenInstance}/{receiptId}
 *
 * Обратите внимание: в отличие от WhatsApp-версии, здесь используется
 * HTTP-метод DELETE, а receiptId передаётся ЧАСТЬЮ ПУТИ (в URL), а не в теле.
 *
 * @param credentials - учётные данные GREEN-API.
 * @param receiptId   - идентификатор уведомления из receiveNotification.
 * @returns ответ сервера (обычно { result: true }).
 */
export const deleteNotification = async (
  credentials: ChatCredentials,
  receiptId: number
): Promise<{ result: boolean }> => {
  // receiptId передаётся частью пути, а не в теле запроса (отличие Telegram-версии).
  const url = `${buildRequestUrl(credentials, 'deleteNotification')}/${receiptId}`;

  const response = await api.delete<{ result: boolean }>(url);

  return response.data;
};

/**
 * Проверяет, относится ли уведомление к открытому в интерфейсе чату.
 *
 * Сложность в том, что пользователь вводит номер телефона, а сервер присылает
 * внутренний chatId (например, "10000000") и номер отправителя в отдельном поле.
 * Поэтому проверяем по двум признакам сразу:
 *   1) совпал внутренний chatId (самый надёжный способ);
 *   2) совпал номер телефона отправителя (запасной вариант, если chatId
 *      получить не удалось).
 *
 * @param notification - тело полученного уведомления.
 * @param chatId       - внутренний chatId открытого чата (может быть пустым).
 * @param phoneDigits  - номер телефона открытого чата (только цифры).
 * @returns true, если сообщение принадлежит открытому чату.
 */
export const isMessageFromChat = (
  notification: GreenApiNotification,
  chatId: string | null,
  phoneDigits: string
): boolean => {
  const senderData = notification.senderData;

  // Если сервер не прислал данные об отправителе — показать сообщение не сможем.
  if (!senderData) {
    return false;
  }

  // Форматы идентификаторов у GREEN-API Telegram могут различаться:
  // "79991234567", "79991234567@c.us", числовой внутренний chatId и т.д.
  // Поэтому сравниваем по ЦИФРАМ — побуквенное сравнение отбрасывало
  // корректные ответы собеседника.
  const toDigits = (value: unknown): string => String(value ?? '').replace(/\D/g, '');

  // Основной вариант: совпадение внутренних идентификаторов чата.
  const notificationChat = toDigits(senderData.chatId);
  const openChat = toDigits(chatId);
  if (openChat && notificationChat === openChat) {
    return true;
  }

  // Запасной вариант: совпадение по номеру телефона отправителя
  // (сравниваем и sender, и senderPhoneNumber — зависит от формата уведомления).
  const openPhone = toDigits(phoneDigits);
  if (openPhone) {
    const senderPhone = toDigits(senderData.senderPhoneNumber) || toDigits(senderData.sender);
    if (senderPhone && senderPhone === openPhone) {
      return true;
    }
    // Номер отправителя может быть «короче» открытого (без кода страны) —
    // сравниваем по окончанию строки длиной от 10 цифр.
    if (senderPhone.length >= 10 && openPhone.endsWith(senderPhone.slice(-10))) {
      return true;
    }
  }

  return false;
};

/**
 * Преобразует тело уведомления GREEN-API в текст сообщения.
 * Возвращает null, если уведомление не является текстовым входящим сообщением.
 *
 * Поддерживаются только текстовые сообщения (typeMessage === 'textMessage') —
 * это требование тестового задания.
 *
 * @param notification - тело полученного уведомления.
 * @returns текст сообщения либо null.
 */
export const extractIncomingText = (
  notification: GreenApiNotification
): string | null => {
  // Нас интересуют только реальные входящие сообщения.
  // Уведомления outgoingMessageReceived / outgoingAPIMessageReceived
  // относятся к нашим же отправкам и привели бы к дублированию в чате.
  if (notification.typeWebhook !== 'incomingMessageReceived') {
    return null;
  }

  const messageData = notification.messageData;

  // Проверяем, что это именно текст, и что текст не пустой.
  if (messageData?.typeMessage !== 'textMessage') {
    return null;
  }

  const text = messageData.textMessageData?.textMessage;

  return text && text.trim() ? text : null;
};

/**
 * Извлекает idMessage из уведомлений о доставке НАШИХ сообщений.
 *
 * GREEN-API присылает два разных типа уведомлений, подтверждающих доставку:
 *   - outgoingMessageReceived    — сообщение отправлено с телефона/другого клиента;
 *   - outgoingAPIMessageReceived — сообщение отправлено через API (наш случай,
 *                                  именно это подтверждение нужно для ✓✓).
 *
 * В обоих случаях idMessage лежит в корне уведомления, а не в messageData.
 *
 * @param notification - тело полученного уведомления.
 * @returns строковый idMessage либо null.
 */
export const extractOutgoingIdMessage = (
  notification: GreenApiNotification
): string | null => {
  const type = notification.typeWebhook;

  // Принимаем оба типа: сообщение могло уйти и через API, и с телефона.
  if (type !== 'outgoingMessageReceived' && type !== 'outgoingAPIMessageReceived') {
    return null;
  }

  // idMessage находится в корне уведомления, а не в messageData.
  const idMessage = notification.idMessage;

  return idMessage && idMessage.trim() ? idMessage : null;
};

/**
 * Экземпляр axios экспортируется по умолчанию — на случай, если в будущем
 * понадобится добавить новые методы GREEN-API в этом же файле.
 */
export default api;