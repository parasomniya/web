/**
 * Обрабатывает массив строк из Excel с рационами
 * @param {Array} rawExelData - Массив объектов с русскими ключами
 * @returns {Object} Результат: { success, data, errors }
 */
function processRationRows(rawExelData) {
  const result = {
    success: true,
    data: [],
    errors: []
  };

  rawExelData.forEach((row, index) => {
    const lineNumber = index + 1;

    // 1. Пропускаем пустые строки
    const values = Object.values(row);
    const isEmptyRow = values.every(val => 
      val === undefined || val === null || String(val).trim() === ''
    );
    if (isEmptyRow) return;

    // 2. Маппинг и очистка
    const name = row['Ингредиент'] ? String(row['Ингредиент']).trim() : '';
    const plannedWeightRaw = row['План'];
    const dryMatterWeightRaw = row['СВ'];

    // 3. Валидация: План
    const plannedWeight = Number(plannedWeightRaw);
    if (isNaN(plannedWeight) || plannedWeight <= 0) {
      result.errors.push(`Строка ${lineNumber}: Вес '${plannedWeightRaw}' не является числом или меньше/равен 0`);
      result.success = false;
      return;
    }

    // 4. Валидация: СВ
    const dryMatterWeight = Number(dryMatterWeightRaw);
    if (isNaN(dryMatterWeight) || dryMatterWeight < 0) {
      result.errors.push(`Строка ${lineNumber}: Сухое вещество '${dryMatterWeightRaw}' не является числом или меньше 0`);
      result.success = false;
      return;
    }

    // 5. Физика: СВ <= вес
    if (dryMatterWeight > plannedWeight) {
      result.errors.push(`Строка ${lineNumber}: Сухое вещество (${dryMatterWeight}) не может быть больше планового веса (${plannedWeight})`);
      result.success = false;
      return;
    }

    // 6. Успех — добавляем в результат
    result.data.push({ name, plannedWeight, dryMatterWeight });
  });

  return result;
}


/**
 * Рассчитывает план замеса рациона на группу коров
 * @param {Array} parsedRation - Массив ингредиентов с нормами на 1 голову
 * @param {number} headcount - Количество голов в группе
 * @returns {Object} Объект с общими и целевыми весами
 */
function calculatePlan(parsedRation, headcount) {
  // 1. Базовая защита от некорректных данных
  if (!Array.isArray(parsedRation) || typeof headcount !== 'number' || headcount <= 0) {
    return { totalBatchWeight: 0, totalDryMatterWeight: 0, ingredients: [] };
  }

  let totalBatchWeight = 0;
  let totalDryMatterWeight = 0;
  const ingredients = [];

  // 2. Проходим по каждому ингредиенту и считаем замес
  for (const item of parsedRation) {
    const targetWeight = item.plannedWeight * headcount;
    const targetDryMatter = item.dryMatterWeight * headcount;

    // Суммируем общие показатели
    totalBatchWeight += targetWeight;
    totalDryMatterWeight += targetDryMatter;

    // Формируем объект ингредиента для результата
    ingredients.push({
      name: item.name,
      targetWeight: targetWeight,
      targetDryMatter: targetDryMatter
    });
  }

  // 3. Возвращаем итоговый объект
  return {
    totalBatchWeight,
    totalDryMatterWeight,
    ingredients
  };
}


/**
 * Сравнивает идеальный план с тем, что реально насыпал тракторист
 * @param {Array} planArr - Массив ингредиентов из calculatePlan
 * @param {Array} factArr - Массив фактических загрузок
 * @param {number} threshold - Допустимый процент погрешности (по умолчанию 10)
 * @returns {Object} { matches: [], violations: [] }
 */
function checkViolations(planArr, factArr, threshold = 10) {
  const result = {
    matches: [],
    violations: []
  };

  // Создаем карту плановых ингредиентов для быстрого поиска по имени
  const planMap = new Map();
  planArr.forEach(item => {
    planMap.set(item.name, item);
  });

  // Проходим по всем фактическим загрузкам
  factArr.forEach(factItem => {
    const planItem = planMap.get(factItem.name);
    
    // Если компонента нет в плане (или это Unknown)
    if (!planItem || factItem.name === 'Unknown') {
      // Это нарушение - загружен компонент вне плана
      result.violations.push({
        ingredient: factItem.name,
        plan: 0,
        fact: factItem.actualWeight,
        deviationPercent: 100,
        message: 'Загружен нераспознанный компонент вне зон'
      });
      return;
    }

    // Рассчитываем отклонение
    const planWeight = planItem.targetWeight || planItem.plannedWeight;
    const factWeight = factItem.actualWeight;
    
    // Формула: ((факт - план) / план) * 100
    const deviationPercent = ((factWeight - planWeight) / planWeight) * 100;
    const absDeviation = Math.abs(deviationPercent);
    
    // Округляем до 1 знака после запятой
    const roundedDeviation = Math.round(deviationPercent * 10) / 10;

    // Проверяем, превышает ли отклонение порог
    if (absDeviation > threshold) {
      // Определяем тип нарушения
      const deviationType = deviationPercent > 0 ? 'Перевес' : 'Недовес';
      const absRounded = Math.round(absDeviation * 10) / 10;
      
      result.violations.push({
        ingredient: factItem.name,
        plan: planWeight,
        fact: factWeight,
        deviationPercent: roundedDeviation,
        message: `${deviationType} на ${absRounded}%`
      });
    } else {
      // Отклонение в пределах нормы
      result.matches.push({
        ingredient: factItem.name,
        plan: planWeight,
        fact: factWeight,
        deviationPercent: roundedDeviation
      });
    }
  });

  // Проверяем, все ли плановые компоненты были загружены
  planArr.forEach(planItem => {
    const factItem = factArr.find(f => f.name === planItem.name);
    if (!factItem) {
      // Компонент был в плане, но не загружен
      const planWeight = planItem.targetWeight || planItem.plannedWeight;
      
      result.violations.push({
        ingredient: planItem.name,
        plan: planWeight,
        fact: 0,
        deviationPercent: -100,
        message: 'Не загружен плановый компонент'
      });
    }
  });

  return result;
}


