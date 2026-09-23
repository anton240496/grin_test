import React, { useEffect, useRef } from 'react';

/**
 * Описание одного сообщения в чате.
 *
 * @property id         - уникальный идентификатор (приходит от GREEN-API);
 * @property text       - текст сообщения (задание ограничено только текстом);
 * @property timestamp  - время отправки в формате Unix (секунды с 1970 года);
 * @property isOutgoing - true — сообщение отправили МЫ, false — пришло собеседнику.
 */
export interface Message {
  id: string;
  text: string;
  timestamp: number;
  isOutgoing: boolean;
  status: 'sending' | 'sent' | 'delivered';
}

/**
 * Свойства компонента окна чата.
 * @property messages - массив сообщений для отображения.
 */
interface ChatWindowProps {
  messages: Message[];
}

/**
 * Переводит Unix-время (секунды) в привычную строку вида «14:35».
 *
 * Замечание: время показываем в локальном часовом поясе пользователя —
 * так же, как это делает веб-клиент Telegram.
 *
 * @param timestamp - время в секундах.
 * @returns строка с часами и минутами.
 */
const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

/**
 * КОМПОНЕНТ ОКНА ЧАТА.
 *
 * Задачи компонента:
 *   1) вывести список сообщений в хронологическом порядке;
 *   2) визуально разделить входящие и исходящие сообщения (как в Telegram);
 *   3) автоматически прокручивать список вниз, когда приходит новое сообщение.
 *
 * Компонент «глупый» (презентационный): он не делает запросов к API и не хранит
 * состояние переписки — всё приходит через props от родительского App.
 */
const ChatWindow: React.FC<ChatWindowProps> = ({ messages }) => {
  // Ссылка на «якорь» в самом низу списка — к нему прокручиваем при новом сообщении.
  const bottomRef = useRef<HTMLDivElement>(null);

  /**
   * Прокрутка вниз при изменении количества сообщений.
   * В зависимостях именно messages.length: прокрутка нужна только когда
   * список реально пополнился, а не при любом перерисовывании.
   */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="chat-window">
      {/* Если переписка пуста, показываем подсказку вместо пустого экрана */}
      {messages.length === 0 ? (
        <div className="chat-empty">
          <p>Сообщений пока нет.</p>
          <p className="chat-empty-hint">
            Напишите первое сообщение — ответ собеседника появится здесь автоматически.
          </p>
        </div>
      ) : (
        messages.map((message) => (
          <div
            key={message.id}
            /* Класс outgoing добавляет выравнивание вправо и синий цвет пузыря */
            className={`message-wrapper ${message.isOutgoing ? 'outgoing' : 'incoming'}`}
          >
            <div className={`message ${message.isOutgoing ? 'outgoing' : 'incoming'}`}>
              {/* Текст сообщения. white-space: pre-wrap в CSS сохраняет переносы строк */}
              <div className="message-text">{message.text}</div>
              <div className="message-time">
                {formatTime(message.timestamp)}
                {/* Галочки исходящих сообщений: одна ✓ — отправлено, две ✓✓ — доставлено.
                    Пока статус 'sending' (сервер ещё не ответил) галочек нет вовсе. */}
                {message.isOutgoing && message.status === 'sent' && <span className="message-status"> ✓</span>}
                {message.isOutgoing && message.status === 'delivered' && <span className="message-status"> ✓✓</span>}
              </div>
            </div>
          </div>
        ))
      )}

      {/* Пустой блок-якорь: к нему прокручивается окно чата */}
      <div ref={bottomRef} />
    </div>
  );
};

export default ChatWindow;
