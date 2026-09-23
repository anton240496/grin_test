import React, { useState } from 'react';
import { ChatCredentials, getErrorMessage } from '../services/api';

/**
 * Свойства компонента AuthForm.
 * @property onSubmit - асинхронная функция входа. Она проверяет учётные данные
 *                      через GREEN-API и, если они верны, сохраняет их.
 *                      Если данные неверны — выбрасывает ошибку, текст которой
 *                      форма показывает пользователю.
 */
interface AuthFormProps {
  onSubmit: (credentials: ChatCredentials) => Promise<void>;
}

/**
 * Форма входа: ввод учётных данных личного кабинета GREEN-API
 * (idInstance и apiTokenInstance).
 *
 * Важно понимать: эти значения нельзя придумать. Сервер GREEN-API обращается
 * к конкретному инстансу по его номеру и сверяет токен. Поэтому случайные
 * цифры дают ошибку 401 (Unauthorized) или 403 (Forbidden).
 */
const AuthForm: React.FC<AuthFormProps> = ({ onSubmit }) => {
  // Идентификатор инстанса из личного кабинета GREEN-API (например, "4100000000")
  const [idInstance, setIdInstance] = useState('');
  // Токен доступа к инстансу (длинная строка из личного кабинета)
  const [apiTokenInstance, setApiTokenInstance] = useState('');
  // Адрес API больше не вводится вручную: он вычисляется из idInstance.
  // Текст ошибки, который показываем под формой
  const [error, setError] = useState<string | null>(null);
  // Признак того, что идёт проверка данных на сервере GREEN-API
  const [isChecking, setIsChecking] = useState(false);

  /**
   * Обработчик отправки формы.
   * Логика: убрать пробелы → проверить заполненность → проверить данные на
   * сервере → показать ошибку или войти.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Убираем случайные пробелы, которые легко скопировать вместе со значением.
    const cleanId = idInstance.trim();
    const cleanToken = apiTokenInstance.trim();

    if (!cleanId || !cleanToken) {
      setError('Заполните оба поля: ID Instance и API Token Instance.');
      return;
    }

    // Проверяем формат ID Instance: только цифры, длина от 8 до 20.
    // Реальные ID бывают разной длины (например, 412345678912 — 12 цифр),
    // поэтому строгий шаблон «ровно 10 цифр» давал ложные ошибки.
    // Проверка отсекает случайные значения вроде "11223" и опечатки
    // и избавляет от непонятной ошибки 401 при отправке сообщения.
    if (!/^\d{8,20}$/.test(cleanId)) {
      setError(
        'ID Instance должен состоять только из цифр (8–20 цифр). Пример: 412345678912. ' +
          'Скопируйте значение из личного кабинета GREEN-API.'
      );
      return;
    }

    // Проверяем длину токена: у GREEN-API это длинная строка.
    // Слишком короткое значение — почти наверняка обрезанное при копировании.
    if (cleanToken.length < 20) {
      setError(
        'API Token Instance выглядит неполным. Скопируйте его из личного кабинета ' +
          'целиком — это строка примерно из 50 символов.'
      );
      return;
    }

    setError(null);
    setIsChecking(true);

    try {
      // Проверка учётных данных выполняется родительским компонентом (App):
      // он обращается к GREEN-API и убеждается, что инстанс авторизован.
      await onSubmit({
        idInstance: cleanId,
        apiTokenInstance: cleanToken,
        // Адрес API вычисляется автоматически из первых цифр idInstance
        // (поле ввода apiUrl в форме больше нет — оно было необязательным).
        apiUrl: undefined,
      });
    } catch (err) {
      // Показываем понятную причину: неверный токен, неавторизованный инстанс и т.д.
      setError(getErrorMessage(err));
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-form-wrapper">
        {/* Заголовок приложения */}
        <h1 className="auth-title">Telegram Чат</h1>
        {/* Подзаголовок с пояснением */}
        <p className="auth-subtitle">
          Введите учетные данные из личного кабинета GREEN-API
        </p>

        {/* Подсказка: где взять данные и как они выглядят */}
        <p className="auth-hint">
          Данные выдаются в личном кабинете{' '}
          <a href="https://console.green-api.com" target="_blank" rel="noreferrer">
            console.green-api.com
          </a>{' '}
          после создания и авторизации инстанса. Произвольные значения не подойдут —
          сервер ответит ошибкой авторизации.
        </p>

        {/* Пример формата данных: помогает понять, что вводить */}
        <div className="auth-example">
          <div className="auth-example-title">Как выглядят настоящие данные</div>
          <div className="auth-example-row">
                   <span>Например</span>
            <span className="auth-example-key">idInstance</span>
            <code>412345678912</code>
            <span className="auth-example-note">цифры из кабинета</span>
          </div>
          <div className="auth-example-row">
     
            <span className="auth-example-key">apiTokenInstance</span>
            <code>d123abcd123abcd123abcd123abcd123abcd123abcd12345ab</code>
            <span className="auth-example-note">50 символов</span>
          </div>
        </div>
        
        {/* Форма ввода учётных данных */}
        <form onSubmit={handleSubmit} className="auth-form">
          {/* Поле ввода ID Instance */}
          <div className="form-group">
            <label htmlFor="idInstance">ID Instance</label>
            <input
              id="idInstance"
              type="text"
              value={idInstance}
              onChange={(e) => setIdInstance(e.target.value)}
              placeholder="Например: 4100000000"
              className="form-input"
              disabled={isChecking}
              autoComplete="off"
              required
            />
          </div>
          
          {/* Поле ввода API Token Instance */}
          <div className="form-group">
            <label htmlFor="apiTokenInstance">API Token Instance</label>
            <input
              id="apiTokenInstance"
              type="password"
              value={apiTokenInstance}
              onChange={(e) => setApiTokenInstance(e.target.value)}
              placeholder="Длинная строка из личного кабинета"
              className="form-input"
              disabled={isChecking}
              autoComplete="off"
              required
            />
          </div>
          
          {/* Текст ошибки проверки учётных данных */}
          {error && <div className="auth-error">{error}</div>}

          {/* Кнопка входа: во время проверки блокируем повторные нажатия */}
          <button type="submit" className="auth-button" disabled={isChecking}>
            {isChecking ? 'Проверяем данные…' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AuthForm;