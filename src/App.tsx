import React, { useState, useEffect, useCallback, useRef } from 'react';
import AuthForm from './components/AuthForm';
import ChatWindow, { Message } from './components/ChatWindow';
import MessageInput from './components/MessageInput';
import {
  ChatCredentials,
  sendMessage,
  checkAccount,
  receiveNotification,
  deleteNotification,
  setSettings,
  isMessageFromChat,
  extractIncomingText,
  extractOutgoingIdMessage,
  normalizePhoneNumber,
  buildChatId,
  getErrorMessage,
  getStateInstance,
  describeInstanceState,
} from './services/api';

/**
 * ============================================================================
 *  ГЛАВНЫЙ КОМПОНЕНТ ПРИЛОЖЕНИЯ «Telegram Чат»
 * ============================================================================
 *
 *  Приложение работает в трёх состояниях, которые сменяют друг друга:
 *    1) НЕТ УЧЁТНЫХ ДАННЫХ  → показываем форму входа (AuthForm);
 *    2) НЕТ ОТКРЫТОГО ЧАТА  → показываем форму ввода номера получателя;
 *    3) ЧАТ ОТКРЫТ          → показываем переписку и поле ввода сообщения.
 *
 *  Все три состояния переживают перезагрузку страницы:
 *    - учётные данные, номер телефона, открытый чат и история сообщений
 *      сохраняются в localStorage и восстанавливаются при старте.
 * ============================================================================
 */

/** Пауза перед повторной попыткой опроса после ошибки (миллисекунды). */
const POLLING_INTERVAL_MS = 4000;

/** Пауза между успешными циклами long-poll (миллисекунды). */
const NEXT_POLL_DELAY_MS = 300;

/** Ключ, под которым учётные данные сохраняются в localStorage. */
const STORAGE_KEY = 'greenApiCredentials';

/** Префикс для ключей истории сообщений в localStorage. */
const MESSAGES_PREFIX = 'greenApiMessages_';

/** Ключ для сохранённого поля ввода номера. */
const PHONE_INPUT_KEY = 'greenApiPhoneInput';

/** Ключ, под которым сохраняется текущий открытый чат (для перезагрузки). */
const ACTIVE_CHAT_KEY = 'greenApiActiveChat';

/** Минимальная длина номера телефона (в цифрах) для попытки создать чат. */
const MIN_PHONE_DIGITS = 10;

/**
 * Строит ключ localStorage для истории сообщений конкретного чата.
 * Если chatId ещё не известен (null), использует номер телефона получателя.
 */
const messagesStorageKey = (chatId: string | null, phoneDigits: string): string => {
  const anchor = chatId || `phone:${phoneDigits}`;
  return `${MESSAGES_PREFIX}${anchor}`;
};

/**
 * Загружает сообщения из localStorage.
 * Возвращает пустой массив, если данных нет или они повреждены.
 */
const loadMessages = (key: string): Message[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Message[];
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
};

/**
 * Сохраняет сообщения в localStorage.
 */
const saveMessages = (key: string, messages: Message[]): void => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(messages));
  } catch {
    // localStorage может быть заполнен или отключён — не ломаем приложение.
  }
};

/**
 * Описание открытого чата.
 * @property chatId      - внутренний chatId GREEN-API (может быть null);
 * @property phoneDigits - номер получателя, только цифры;
 * @property phoneDisplay - номер для показа пользователю (например, +79991234567);
 * @property title       - заголовок чата (имя или @username собеседника).
 */
interface ActiveChat {
  chatId: string | null;
  phoneDigits: string;
  phoneDisplay: string;
  title: string;
}

const App: React.FC = () => {
  /** Учётные данные GREEN-API. Пока null — показываем форму входа. */
  const [credentials, setCredentials] = useState<ChatCredentials | null>(null);

  /** Текст, который пользователь набирает в поле «номер телефона получателя». */
  const [phoneInput, setPhoneInput] = useState('');

  /** Открытый чат. Пока null — показываем форму ввода номера. */
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);

  /** Список сообщений открытого чата. */
  const [messages, setMessages] = useState<Message[]>([]);

  /** Идёт ли отправка сообщения (блокирует поле ввода и кнопку). */
  const [isSending, setIsSending] = useState(false);

  /** Идёт ли создание чата (проверка номера через checkAccount). */
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  /** Текст ошибки, который мы показываем пользователю. */
  const [error, setError] = useState<string | null>(null);

  /**
   * ПРИ СТАРТЕ восстанавливаем из localStorage всё, что переживает перезагрузку:
   *   1) учётные данные;
   *   2) последний открытый чат;
   *   3) последний введённый номер;
   *   4) историю сообщений открытого чата.
   *
   * Если восстановить удалось, пользователь после F5 остаётся в том же чате
   * с той же перепиской — заново вводить номер не нужно.
   */
  useEffect(() => {
    // 1. Учётные данные.
    const savedCreds = localStorage.getItem(STORAGE_KEY);
    let parsedCreds: ChatCredentials | null = null;
    if (savedCreds) {
      try {
        parsedCreds = JSON.parse(savedCreds) as ChatCredentials;
        setCredentials(parsedCreds);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    // 2. Номер телефона, который вводили в прошлый раз.
    const savedPhone = localStorage.getItem(PHONE_INPUT_KEY);
    if (savedPhone) {
      setPhoneInput(savedPhone);
    }

    // 3. Открытый чат — восстанавливаем только при наличии учётных данных.
    const savedChat = localStorage.getItem(ACTIVE_CHAT_KEY);
    if (savedChat && parsedCreds) {
      try {
        const chat = JSON.parse(savedChat) as ActiveChat;
        if (chat && chat.phoneDigits) {
          setActiveChat(chat);
          // 4. И сразу подгружаем историю сообщений этого чата.
          setMessages(loadMessages(messagesStorageKey(chat.chatId, chat.phoneDigits)));
        }
      } catch {
        localStorage.removeItem(ACTIVE_CHAT_KEY);
      }
    }
  }, []);

  /**
   * Сохраняем номер в localStorage при каждом его изменении,
   * чтобы после перезагрузки не вводить его заново.
   */
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(PHONE_INPUT_KEY, phoneInput);
    } catch {
      // игнорируем ошибки localStorage
    }
  }, [phoneInput]);

  /**
   * Сохраняем открытый чат в localStorage, пока он открыт.
   * При закрытии чата (setActiveChat(null)) запись удаляется в handleCloseChat.
   */
  useEffect(() => {
    if (!activeChat) {
      return;
    }
    try {
      localStorage.setItem(ACTIVE_CHAT_KEY, JSON.stringify(activeChat));
    } catch {
      // игнорируем ошибки localStorage
    }
  }, [activeChat]);

  /**
   * Периодически сохраняем историю сообщений открытого чата,
   * чтобы перезагрузка страницы не теряла переписку.
   */
  useEffect(() => {
    if (!activeChat) {
      return;
    }
    const key = messagesStorageKey(activeChat.chatId, activeChat.phoneDigits);
    saveMessages(key, messages);
  }, [messages, activeChat]);

  /**
   * ВХОД В СИСТЕМУ С ПРОВЕРКОЙ УЧЁТНЫХ ДАННЫХ.
   *
   * Сразу вызываем getStateInstance:
   *   - неверный idInstance/apiTokenInstance → 401/403, показываем причину;
   *   - инстанс не авторизован в Telegram → подсказка, как подключить;
   *   - состояние «authorized» → вход.
   */
  const handleAuthSubmit = async (creds: ChatCredentials): Promise<void> => {
    const state = await getStateInstance(creds);

    if (state !== 'authorized') {
      throw new Error(describeInstanceState(state));
    }

    // Технология HTTP API требует перед началом receiveNotification настроить
    // очередь уведомлений методом SetSettings: пустой webhookUrl (иначе
    // уведомления уходят на сервер приложения и опрос их не видит)
    // + включённые входящие/исходящие/статусные уведомления.
    // Ошибка здесь не блокирует вход: инстанс мог быть настроен ранее.
    try {
      const settingsResult = await setSettings(creds);
      // [ДИАГ] показываем ответ сервера: saveSettings: true = очередь настроена.
      console.log('[ДИАГ] setSettings →', settingsResult);
    } catch (err) {
      // Если здесь ошибка — очередь уведомлений НЕ настроена и
      // receiveNotification будет возвращать null (сообщения не приходят).
      console.error('[ДИАГ] setSettings ОШИБКА (очередь не настроена!):', getErrorMessage(err));
    }

    setCredentials(creds);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
    setError(null);
  };

  /**
   * Идентификаторы наших сообщений, которые сервер уже подтвердил как доставленные.
   *
   * Нужно для защиты от гонки: уведомление outgoingAPIMessageReceived может
   * прийти по опросу раньше, чем sendMessage успеет добавить сообщение в список.
   * Тогда подтверждение «терялось» и вторая галочка не появлялась бы никогда.
   * Сохраняем id здесь и учитываем при добавлении сообщения в чат.
   */
  const deliveredIdsRef = useRef<Set<string>>(new Set());

  /**
   * ЭФФЕКТ ОПРОСА СЕРВЕРА НА НОВЫЕ СООБЩЕНИЯ.
   *
   * Работает по технологии HTTP API GREEN-API: циклически вызываем
   * receiveNotification и полученное уведомление сразу подтверждаем
   * методом deleteNotification.
   *
   * Обрабатываются два типа уведомлений:
   *   - incomingMessageReceived — входящее сообщение собеседника;
   *   - outgoingMessageReceived — подтверждение, что НАШЕ сообщение доставлено
   *     (тогда статус меняется с «sent» на «delivered» и появляется ✓✓).
   *
   * Эффект перезапускается при смене учётных данных или открытого чата,
   * а при закрытии чата/выходе интервал корректно очищается.
   */
  useEffect(() => {
    if (!credentials || !activeChat) {
      return undefined;
    }

    // Флаг отмены: не позволяем «запоздалым» ответам менять состояние.
    let cancelled = false;

    // Идентификатор таймера следующего цикла (вместо setInterval).
    let timeoutId: number | undefined;

    /** Планирует следующий цикл опроса. */
    const scheduleNext = (delay: number) => {
      if (cancelled) return;
      timeoutId = window.setTimeout(runPoll, delay);
    };

    /**
     * Один цикл опроса: получить одно уведомление, обработать его
     * и только ПОСЛЕ завершения запланировать следующий запрос.
     * Так уведомления не теряются и не накапливаются параллельные
     * long-poll запросы (причина старых «timeout of 10000ms exceeded»).
     */
    const runPoll = async () => {
      try {
        const notification = await receiveNotification(credentials);

        // Очередь пуста (сервер вернул null) — новых сообщений нет.
        if (!cancelled && notification) {
          const { receiptId, body } = notification;

          // Подтверждаем обработку уведомления, иначе сервер будет выдавать его повторно.
          await deleteNotification(credentials, receiptId);

          if (!cancelled) {
            // Случай 1: входящее сообщение собеседника.
            const text = extractIncomingText(body);
            const fromChat = isMessageFromChat(body, activeChat.chatId, activeChat.phoneDigits);

            // [ДИАГ] каждое уведомление и вердикт фильтра — чтобы видеть,
            // почему ответ собеседника мог не появиться в чате.
            console.log('[ДИАГ] уведомление №' + receiptId, {
              typeWebhook: body.typeWebhook,
              typeMessage: body.messageData?.typeMessage,
              idMessage: body.idMessage,
              senderData: body.senderData,
              открытыйЧат: activeChat,
              текст: text,
              отТогоЧата: fromChat,
            });

            if (text && fromChat) {
              console.log('[ДИАГ] → ДОБАВЛЕНО в чат');
              setMessages((prev) => {
                if (prev.some((m) => m.id === body.idMessage)) return prev;
                const incoming: Message = {
                  id: body.idMessage,
                  text,
                  timestamp: body.timestamp || Math.floor(Date.now() / 1000),
                  isOutgoing: false,
                  status: 'delivered',
                };
                return [...prev, incoming].sort((a, b) => a.timestamp - b.timestamp);
              });
            } else {
              // Случай 2: подтверждение доставки нашего исходящего сообщения.
              const outgoingId = extractOutgoingIdMessage(body);
              if (outgoingId) {
                // Запоминаем подтверждение на случай, если сообщение ещё не добавлено в чат.
                deliveredIdsRef.current.add(outgoingId);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === outgoingId && m.status !== 'delivered'
                      ? { ...m, status: 'delivered' }
                      : m
                  )
                );
              }
            }
          }
        }

        // Предыдущий запрос завершён — стартуем следующий через короткую паузу.
        scheduleNext(NEXT_POLL_DELAY_MS);
      } catch (err) {
        // Ошибку опроса не показываем модальным окном, но фиксируем в консоли.
        console.error('Ошибка получения сообщений:', getErrorMessage(err));
        // Делаем паузу перед повторной попыткой, чтобы не долбить сервер ошибками.
        scheduleNext(POLLING_INTERVAL_MS);
      }
    };

    // Первый запрос планируем сразу при открытии чата.
    scheduleNext(0);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [credentials, activeChat]);

  /**
   * СОЗДАНИЕ НОВОГО ЧАТА (срабатывает по нажатию кнопки «Создать чат»).
   *
   * Порядок действий:
   *   1) проверяем, что номер введён полностью;
   *   2) через checkAccount узнаём внутренний chatId и проверяем аккаунт;
   *   3) открываем чат — подгружаем сохранённую историю и запускаем опрос.
   */
  const handleCreateChat = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!credentials || isCreatingChat) return;

    const digits = normalizePhoneNumber(phoneInput);

    if (digits.length < MIN_PHONE_DIGITS) {
      setError('Введите номер телефона полностью, например, 79991234567');
      return;
    }

    setError(null);
    setIsCreatingChat(true);

    let chatId: string | null = null;
    let title = `+${digits}`;

    try {
      const account = await checkAccount(credentials, digits);

      if (account.exist === false) {
        setError('Учётная запись не найдена в Telegram. Проверьте номер.');
        setIsCreatingChat(false);
        return;
      }

      if (account.chatId) {
        chatId = String(account.chatId);
      }
      if (account.username) {
        title = `@${account.username}`;
      }
    } catch (err) {
      // checkAccount — вспомогательный метод. Если он недоступен,
      // сообщение можно отправить по номеру в формате «номер@c.us».
      console.warn('checkAccount недоступен, используем номер телефона:', getErrorMessage(err));
    }

    // Подгружаем ранее сохранённую историю этого чата (если она есть).
    const key = messagesStorageKey(chatId, digits);
    setMessages(loadMessages(key));
    setActiveChat({ chatId, phoneDigits: digits, phoneDisplay: `+${digits}`, title });
    setIsCreatingChat(false);
  };

  /**
   * ОТПРАВКА СООБЩЕНИЯ.
   *
   * Статусы галочек (важно для пункта 3 задания):
   *   - сразу после отправки: status = 'sent'    → показываем одну галочку ✓;
   *   - после outgoingMessageReceived от сервера: 'delivered' → ✓✓.
   *
   * Мгновенных двух галочек при нажатии «Отправить» больше НЕТ —
   * вторая галочка появляется только когда сервер подтвердил доставку.
   */
  const handleSendMessage = async (text: string) => {
    if (!credentials || !activeChat || isSending) return;

    setIsSending(true);
    setError(null);

    const chatIdForApi = activeChat.chatId || buildChatId(activeChat.phoneDigits);

    try {
      const result = await sendMessage(credentials, chatIdForApi, text);

      const outgoing: Message = {
        id: result.idMessage || `outgoing-${Date.now()}`,
        text,
        timestamp: Math.floor(Date.now() / 1000),
        isOutgoing: true,
        // Если подтверждение доставки успело прийти раньше (гонка опроса) —
        // сразу показываем ✓✓, иначе ставим «отправлено» и ждём уведомления.
        status:
          result.idMessage && deliveredIdsRef.current.has(result.idMessage)
            ? 'delivered'
            : 'sent',
      };

      setMessages((prev) =>
        prev.some((m) => m.id === outgoing.id) ? prev : [...prev, outgoing]
      );
    } catch (err) {
      setError(`Не удалось отправить: ${getErrorMessage(err)}`);
    } finally {
      setIsSending(false);
    }
  };

  /**
   * ЗАКРЫТИЕ ЧАТА: сохраняем историю, удаляем запись об открытом чате
   * и возвращаемся к форме ввода номера. Номер телефона при этом
   * СОХРАНЯЕТСЯ в поле ввода — заново набирать его не нужно.
   */
  const handleCloseChat = useCallback(() => {
    if (!activeChat) return;
    const key = messagesStorageKey(activeChat.chatId, activeChat.phoneDigits);
    saveMessages(key, messages);
    localStorage.removeItem(ACTIVE_CHAT_KEY);
    setActiveChat(null);
    setMessages([]);
    setError(null);
  }, [activeChat, messages]);

  /**
   * СМЕНА АККАУНТА: полностью выходим и очищаем сохранённые данные.
   */
  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PHONE_INPUT_KEY);
    localStorage.removeItem(ACTIVE_CHAT_KEY);
    setCredentials(null);
    setActiveChat(null);
    setMessages([]);
    setPhoneInput('');
    setError(null);
  };

  /* -------------------------------------------------------------------------
   *  ОТРИСОВКА ИНТЕРФЕЙСА
   * ----------------------------------------------------------------------- */

  // СОСТОЯНИЕ 1: учётные данные не введены — показываем форму входа.
  if (!credentials) {
    return <AuthForm onSubmit={handleAuthSubmit} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Telegram Чат</h1>
        {/* Кнопка выхода: удаляет сохранённые учётные данные */}
        <button type="button" className="logout-button" onClick={handleLogout}>
          Сменить аккаунт
        </button>
      </header>

      {/* Текст ошибки показываем и при создании чата, и внутри переписки */}
      {error && <div className="error-banner">{error}</div>}

      {!activeChat ? (
        /* СОСТОЯНИЕ 2: чат ещё не создан — показываем форму ввода номера.
           Переход к переписке происходит только по нажатию «Создать чат». */
        <div className="phone-input-container">
          <h2>Введите номер телефона</h2>
          <p className="phone-hint">
            Укажите номер получателя в международном формате. Достаточно цифр —
            знаки «+», пробелы и дефисы можно не использовать.
          </p>

          <form className="phone-form" onSubmit={handleCreateChat}>
            <input
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="Например: 79991234567"
              className="form-input"
              disabled={isCreatingChat}
              autoComplete="off"
            />
            <button
              type="submit"
              className="auth-button"
              disabled={isCreatingChat || !phoneInput.trim()}
            >
              {isCreatingChat ? 'Проверяем номер…' : 'Создать чат'}
            </button>
          </form>
        </div>
      ) : (
        /* СОСТОЯНИЕ 3: чат создан — показываем переписку и поле ввода */
        <div className="chat-container">
          <div className="chat-header">
            <div className="chat-header-info">
              <span className="chat-title">{activeChat.title}</span>
              <span className="chat-subtitle">{activeChat.phoneDisplay}</span>
            </div>
            <button
              type="button"
              onClick={handleCloseChat}
              className="change-chat-button"
              title="Закрыть чат и выбрать другого получателя"
            >
              ✕
            </button>
          </div>

          {/* Окно переписки */}
          <ChatWindow messages={messages} />

          {/* Поле ввода нового сообщения */}
          <MessageInput onSendMessage={handleSendMessage} disabled={isSending} />
        </div>
      )}
    </div>
  );
};

export default App;
