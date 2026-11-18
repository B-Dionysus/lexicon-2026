function createDataAccess({ dynamodb, tables, logger = () => {} }) {
  const log = (...args) => {
    try {
      logger(...args);
    } catch (_err) {
      // ignore logging errors
    }
  };

  async function getProfile(userName) {
    if (!userName) return null;
    log('dataAccess.getProfile', userName);
    const result = await dynamodb.get({
      TableName: tables.profiles,
      Key: { user_name: userName },
      ProjectionExpression: 'user_name,researcher_name,researcher_bio,#email,notify_word_created,notify_round_complete,password_hash,created_at,updated_at,game_id,#admin',
      ExpressionAttributeNames: { '#email': 'email', '#admin': 'admin' },
      ConsistentRead: true
    }).promise();
    return result.Item || null;
  }

  async function getProfilesByUserNames(userNames) {
    const uniqueUserNames = [...new Set((userNames || []).filter(Boolean))];
    if (!uniqueUserNames.length) return [];
    log('dataAccess.getProfilesByUserNames', uniqueUserNames.length);
    const response = await dynamodb.batchGet({
      RequestItems: {
        [tables.profiles]: {
          Keys: uniqueUserNames.map((userName) => ({ user_name: userName })),
          ProjectionExpression: 'user_name,researcher_name,researcher_bio,created_at,updated_at'
        }
      }
    }).promise();
    return response.Responses?.[tables.profiles] || [];
  }

  const wordProjectionAttributeNames = {
    '#word_id': 'word_id',
    '#word': 'word',
    '#user_name': 'user_name',
    '#definition': 'definition',
    '#new_word_1': 'new_word_1',
    '#new_word_2': 'new_word_2',
    '#new_word_1_id': 'new_word_1_id',
    '#new_word_2_id': 'new_word_2_id',
    '#previous_word_id': 'previous_word_id',
    '#created_at': 'created_at',
    '#updated_at': 'updated_at',
    '#game_id': 'game_id'
  };

  const wordProjectionExpression = '#word_id,#word,#user_name,#definition,#new_word_1,#new_word_2,#new_word_1_id,#new_word_2_id,#previous_word_id,#created_at,#updated_at,#game_id';

  async function listWordsByGame(gameId) {
    log('dataAccess.listWordsByGame', gameId);
    const params = {
      TableName: tables.words,
      IndexName: 'game_id-word-index',
      KeyConditionExpression: 'game_id = :gameId',
      ExpressionAttributeValues: { ':gameId': gameId },
      FilterExpression: 'attribute_not_exists(#record_type)',
      ProjectionExpression: wordProjectionExpression,
      ExpressionAttributeNames: { ...wordProjectionAttributeNames, '#record_type': 'record_type' }
    };
    const res = await dynamodb.query(params).promise();
    return (res.Items || []).sort((a, b) => {
      if (a.word === b.word) {
        return (a.created_at || '').localeCompare(b.created_at || '');
      }
      return a.word.localeCompare(b.word);
    });
  }

  async function listWordsByName(gameId, word) {
    const params = {
      TableName: tables.words,
      IndexName: 'game_id-word-index',
      KeyConditionExpression: 'game_id = :gameId AND #word = :word',
      ExpressionAttributeValues: { ':gameId': gameId, ':word': word },
      ExpressionAttributeNames: { '#word': 'word', '#record_type': 'record_type' },
      FilterExpression: 'attribute_not_exists(#record_type)'
    };
    const res = await dynamodb.query(params).promise();
    return res.Items || [];
  }

  async function getCacheSignal(gameId) {
    if (!gameId) return null;
    log('dataAccess.getCacheSignal', gameId);
    const result = await dynamodb.get({
      TableName: tables.cacheSignals,
      Key: { game_id: gameId },
      ConsistentRead: true,
      ProjectionExpression: 'game_id,last_invalidated'
    }).promise();
    return result.Item ? result.Item.last_invalidated : null;
  }

  async function touchCacheSignal(gameId) {
    if (!gameId) return null;
    const now = new Date().toISOString();
    log('dataAccess.touchCacheSignal', gameId, now);
    await dynamodb.put({
      TableName: tables.cacheSignals,
      Item: { game_id: gameId, last_invalidated: now }
    }).promise();
    return now;
  }

  async function listWordsByUserNameAndGame(userName, gameId) {
    if (!userName) return [];
    log('dataAccess.listWordsByUserNameAndGame', { userName, gameId });
    const params = {
      TableName: tables.words,
      IndexName: 'user_name-game_id-index',
      KeyConditionExpression: 'user_name = :userName AND game_id = :gameId',
      ExpressionAttributeValues: {
        ':userName': userName,
        ':gameId': gameId
      },
      ProjectionExpression: '#word_id,#word,#user_name,#definition,#created_at,#updated_at,#game_id',
      ExpressionAttributeNames: {
        '#word_id': 'word_id',
        '#word': 'word',
        '#user_name': 'user_name',
        '#definition': 'definition',
        '#created_at': 'created_at',
        '#updated_at': 'updated_at',
        '#game_id': 'game_id'
      }
    };
    const res = await dynamodb.query(params).promise();
    return (res.Items || []).sort((a, b) => {
      if (a.word === b.word) {
        return (a.created_at || '').localeCompare(b.created_at || '');
      }
      return a.word.localeCompare(b.word);
    });
  }

  async function getWord(wordId) {
    log('dataAccess.getWord', wordId);
    const result = await dynamodb.get({
      TableName: tables.words,
      Key: { word_id: wordId },
      ProjectionExpression: wordProjectionExpression,
      ExpressionAttributeNames: wordProjectionAttributeNames
    }).promise();
    return result.Item || null;
  }

  async function getGame(gameId) {
    log('dataAccess.getGame', gameId);
    const result = await dynamodb.get({
      TableName: tables.games,
      Key: { game_id: gameId },
      ConsistentRead: true,
      ProjectionExpression: 'game_id,subtitle,#name,current_letter,completed',
      ExpressionAttributeNames: { '#name': 'name' }
    }).promise();
    return result.Item || null;
  }

  async function listGameMemberNames(gameId) {
    const names = [];
    let lastKey;
    do {
      const result = await dynamodb.query({
        TableName: tables.researchers,
        IndexName: 'game_id-user_name-index',
        KeyConditionExpression: 'game_id = :gameId',
        ExpressionAttributeValues: { ':gameId': gameId },
        ProjectionExpression: 'user_name',
        ...(lastKey && { ExclusiveStartKey: lastKey })
      }).promise();
      names.push(...(result.Items || []).map((item) => item.user_name));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return names;
  }

  async function getProfilesForNotification(userNames, preference) {
    const profiles = [];
    for (let i = 0; i < userNames.length; i += 100) {
      const response = await dynamodb.batchGet({
        RequestItems: {
          [tables.profiles]: {
            Keys: userNames.slice(i, i + 100).map((userName) => ({ user_name: userName })),
            ProjectionExpression: 'user_name,#email,#preference',
            ExpressionAttributeNames: { '#email': 'email', '#preference': preference }
          }
        }
      }).promise();
      profiles.push(...(response.Responses?.[tables.profiles] || []));
    }
    return profiles.filter((profile) => profile[preference] === true && profile.email);
  }

  // Players belong to a game through a researchers row; profiles created before that
  // table existed are still matched by their original game_id.
  async function listNotificationRecipients(gameId, preference) {
    const recipients = new Map();
    let lastKey;
    do {
      const result = await dynamodb.scan({
        TableName: tables.profiles,
        FilterExpression: 'game_id = :gameId AND #preference = :enabled AND attribute_exists(#email)',
        ExpressionAttributeValues: { ':gameId': gameId, ':enabled': true },
        ExpressionAttributeNames: { '#email': 'email', '#preference': preference },
        ProjectionExpression: 'user_name,#email',
        ConsistentRead: true,
        ...(lastKey && { ExclusiveStartKey: lastKey })
      }).promise();
      for (const profile of result.Items || []) if (profile.email) recipients.set(profile.user_name, profile);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    const members = await getProfilesForNotification(await listGameMemberNames(gameId), preference);
    for (const profile of members) recipients.set(profile.user_name, { user_name: profile.user_name, email: profile.email });
    return [...recipients.values()];
  }

  async function listRoundRecipients(gameId) {
    return listNotificationRecipients(gameId, 'notify_round_complete');
  }

  async function listWordRecipients(gameId) {
    return listNotificationRecipients(gameId, 'notify_word_created');
  }

  async function advanceRound(gameId, letter) {
    const finalRound = letter === 'Z';
    const nextLetter = finalRound ? letter : String.fromCharCode(letter.charCodeAt(0) + 1);
    await dynamodb.update({
      TableName: tables.games,
      Key: { game_id: gameId },
      UpdateExpression: 'SET current_letter = :next, completed = :completed',
      ConditionExpression: 'attribute_exists(game_id) AND (attribute_not_exists(completed) OR completed = :false) AND ' +
        (letter === 'A' ? '(attribute_not_exists(current_letter) OR current_letter = :letter)' : 'current_letter = :letter'),
      ExpressionAttributeValues: { ':letter': letter, ':next': nextLetter, ':completed': finalRound, ':false': false }
    }).promise();
    return { current_letter: nextLetter, completed: finalRound };
  }

  async function createWordWithRelated(item, relatedItems = [], nameClaims = []) {
    const transactItems = [
      ...nameClaims.map((claim) => ({
        Put: {
          TableName: tables.words,
          Item: claim.item,
          ConditionExpression: 'attribute_not_exists(word_id) OR target_word_id = :targetWordId',
          ExpressionAttributeValues: { ':targetWordId': claim.targetWordId }
        }
      })),
      { Put: { TableName: tables.words, Item: item } },
      ...relatedItems.map((relatedItem) => ({ Put: { TableName: tables.words, Item: relatedItem } }))
    ];
    log('dataAccess.createWordWithRelated', { itemCount: transactItems.length });
    await dynamodb.transactWrite({ TransactItems: transactItems }).promise();
    return item;
  }

  async function updateWord(wordId, updates, options = {}) {
    const updateExpression = Object.keys(updates).map((key) => `#${key} = :${key}`).join(', ');
    const expressionAttributeNames = Object.keys(updates).reduce((acc, key) => ({ ...acc, [`#${key}`]: key }), {});
    const expressionAttributeValues = Object.keys(updates).reduce((acc, key) => ({ ...acc, [`:${key}`]: updates[key] }), {});
    const params = {
      TableName: tables.words,
      Key: { word_id: wordId },
      UpdateExpression: `SET ${updateExpression}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };
    if (Object.hasOwn(options, 'expectedDefinition')) {
      params.ConditionExpression = 'attribute_exists(word_id) AND ' +
        (options.expectedDefinition === undefined ? 'attribute_not_exists(#definition)' : '#definition = :previousDefinition');
      if (options.expectedDefinition !== undefined) params.ExpressionAttributeValues[':previousDefinition'] = options.expectedDefinition;
    }
    log('dataAccess.updateWord', wordId, updates);
    const res = await dynamodb.update(params).promise();
    return res.Attributes;
  }

  async function updateProfile(userName, updates) {
    const updateExpression = Object.keys(updates).map((key) => `#${key} = :${key}`).join(', ');
    const expressionAttributeNames = Object.keys(updates).reduce((acc, key) => ({ ...acc, [`#${key}`]: key }), {});
    const expressionAttributeValues = Object.keys(updates).reduce((acc, key) => ({ ...acc, [`:${key}`]: updates[key] }), {});
    const params = {
      TableName: tables.profiles,
      Key: { user_name: userName },
      UpdateExpression: `SET ${updateExpression}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    };
    log('dataAccess.updateProfile', userName);
    await dynamodb.update(params).promise();
  }

  async function getResearcher(userName, gameId) {
    if (!userName || !gameId) return null;
    log('dataAccess.getResearcher', { userName, gameId });
    const result = await dynamodb.get({
      TableName: tables.researchers,
      Key: { user_name: userName, game_id: gameId },
      ConsistentRead: true
    }).promise();
    return result.Item || null;
  }

  async function getResearchersByGame(gameId, userNames) {
    const uniqueUserNames = [...new Set((userNames || []).filter(Boolean))];
    const researchers = [];
    for (let i = 0; i < uniqueUserNames.length; i += 100) {
      log('dataAccess.getResearchersByGame', gameId, uniqueUserNames.length);
      const response = await dynamodb.batchGet({
        RequestItems: {
          [tables.researchers]: {
            Keys: uniqueUserNames.slice(i, i + 100).map((userName) => ({ user_name: userName, game_id: gameId })),
            ProjectionExpression: 'user_name,game_id,researcher_name,researcher_bio'
          }
        }
      }).promise();
      researchers.push(...(response.Responses?.[tables.researchers] || []));
    }
    return researchers;
  }

  async function saveResearcher(userName, gameId, { researcher_name, researcher_bio }) {
    log('dataAccess.saveResearcher', { userName, gameId });
    const now = new Date().toISOString();
    await dynamodb.update({
      TableName: tables.researchers,
      Key: { user_name: userName, game_id: gameId },
      UpdateExpression: 'SET researcher_name = :name, researcher_bio = :bio, updated_at = :now, created_at = if_not_exists(created_at, :now)',
      ExpressionAttributeValues: { ':name': researcher_name, ':bio': researcher_bio, ':now': now }
    }).promise();
  }

  return {
    getProfile,
    getProfilesByUserNames,
    listWordsByGame,
    listWordsByName,
    getCacheSignal,
    touchCacheSignal,
    listWordsByUserNameAndGame,
    getWord,
    getGame,
    listRoundRecipients,
    listWordRecipients,
    advanceRound,
    createWordWithRelated,
    updateWord,
    updateProfile,
    getResearcher,
    getResearchersByGame,
    saveResearcher
  };
}

module.exports = {
  createDataAccess
};
