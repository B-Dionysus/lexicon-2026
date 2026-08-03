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
      ProjectionExpression: 'user_name,researcher_name,researcher_bio,password_hash,created_at,updated_at'
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
      ProjectionExpression: wordProjectionExpression,
      ExpressionAttributeNames: wordProjectionAttributeNames
    };
    const res = await dynamodb.query(params).promise();
    return (res.Items || []).sort((a, b) => {
      if (a.word === b.word) {
        return (a.created_at || '').localeCompare(b.created_at || '');
      }
      return a.word.localeCompare(b.word);
    });
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
      ProjectionExpression: 'game_id,subtitle'
    }).promise();
    return result.Item || null;
  }

  async function createWordWithRelated(item, relatedItems = []) {
    const transactItems = [{ Put: { TableName: tables.words, Item: item } }, ...relatedItems.map((relatedItem) => ({ Put: { TableName: tables.words, Item: relatedItem } }))];
    log('dataAccess.createWordWithRelated', { itemCount: transactItems.length });
    await dynamodb.transactWrite({ TransactItems: transactItems }).promise();
    return item;
  }

  async function updateWord(wordId, updates) {
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
    log('dataAccess.updateProfile', userName, updates);
    await dynamodb.update(params).promise();
  }

  return {
    getProfile,
    getProfilesByUserNames,
    listWordsByGame,
    getCacheSignal,
    touchCacheSignal,
    listWordsByUserNameAndGame,
    getWord,
    getGame,
    createWordWithRelated,
    updateWord,
    updateProfile
  };
}

module.exports = {
  createDataAccess
};
