import React, { useState } from 'react';

/**
 * Интерфейс свойств для компонента MessageInput
 * @property onSendMessage - Функция для отправки текстового сообщения
 * @property disabled - Флаг блокировки ввода (опционально)
 */
interface MessageInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

/**
 * Компонент поля ввода сообщения
 * Позволяет пользователю вводить текст сообщения и отправлять его
 */
const MessageInput: React.FC<MessageInputProps> = ({ onSendMessage, disabled }) => {
  // Состояние для хранения текста введённого сообщения
  const [message, setMessage] = useState('');

  /**
   * Обработчик отправки формы
   * Проверяет валидность ввода и вызывает onSendMessage
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Проверяем, что поле не пустое и не отключено
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  return (
    <div className="message-input-container">
      {/* Форма для ввода и отправки сообщения */}
      <form onSubmit={handleSubmit} className="message-form">
        {/* Поле ввода текста сообщения */}
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Введите сообщение..."
          className="message-input"
          disabled={disabled}
          maxLength={1000}
        />
        {/* Кнопка отправки сообщения */}
        <button 
          type="submit" 
          className="send-button"
          disabled={disabled || !message.trim()}
          title="Отправить сообщение"
        >
          Отправить
        </button>
      </form>
    </div>
  );
};

export default MessageInput;