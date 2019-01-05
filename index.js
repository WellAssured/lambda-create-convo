global.fetch = require('node-fetch');
const AmazonCognitoIdentity = require('amazon-cognito-identity-js');

exports.handler = (event, context, callback) => {

    if (event["Records"].length === 0) {
        callback(null, event);
        return; 
    }
    
    // Log in via my Cognito
    const authDetails = new AmazonCognitoIdentity.AuthenticationDetails({
        Username: process.env.cognito_username,
        Password: process.env.cognito_pw
    });
    const userPool = new AmazonCognitoIdentity.CognitoUserPool({
        UserPoolId : event["Records"][0].messageAttributes.userPoolId.stringValue,
        ClientId : event["Records"][0].messageAttributes.clientId.stringValue
    });
    const jacksCognito = new AmazonCognitoIdentity.CognitoUser({
        Username: process.env.cognito_username,
        Pool: userPool
    });
    
    jacksCognito.authenticateUser(authDetails, {
        onSuccess: session => {
            const jwtToken = session.getAccessToken().getJwtToken();
            const newUsers = {};
            let user = {};
            let message;
            for (i in event["Records"]) {
                message = event["Records"][i];
                user = JSON.parse(message.body).newUser;
                newUsers[user.name] = user;
            }
            const rdSubMap = JSON.parse(process.env.rd_sub_map);
            const newUserKeys = Object.keys(newUsers);
            for (i in newUserKeys) {
                const newUser = newUsers[newUserKeys[i]];
                // first, figure out what Dietitian this User will be assigned to
                // Default RD is Lora, but if they use a particular RD's promo code, we'll assign that user to that RD.
                let promo = 'lora';
                if (newUser.promo !== undefined && Object.keys(rdSubMap).includes(newUser.promo.toLowerCase())) {
                    promo = newUser.promo.toLowerCase();
                }
                const rdSub = rdSubMap[promo];
                const rdName = promo.charAt(0).toUpperCase() + promo.slice(1);
                // Create a new conversation between the new User and Lora
                // Create Conversation Mutation
                const createConvo = `mutation createConvo($participants: [ID!]!) {
                    createConversation(input: { participants: $participants }) { conversationId }
                }`;
                const participants = { participants: [newUser.sub, rdSub] };
                const welcomeText = `Hey there, ${newUser.name}! Welcome to TailRD Nutrition! Your personal Dietitian is ${rdName} - feel free to get things started.`;
                const sendWelcomeMessage = `mutation createMessage($convoId: ID!) {
                    sendMessage(input: {
                        conversationId: $convoId,
                        content: "${welcomeText}"
                    }) { timestamp }
                }`;
                fetch(process.env.gql_api_url, {
                    method: 'POST',
                    body: JSON.stringify({
                        query: createConvo,
                        operationName: 'createConvo',
                        variables: participants
                    }),
                    headers: {
                        'Authorization': jwtToken,
                        'Content-Type': 'application/json'
                    }
                }).then(res => res.json()).then(json =>
                    fetch(process.env.gql_api_url, {
                        method: 'POST',
                        body: JSON.stringify({
                            query: sendWelcomeMessage,
                            operationName: 'createMessage',
                            variables: { convoId: json.data.createConversation.conversationId }
                        }),
                        headers: {
                            'Authorization': jwtToken,
                            'Content-Type': 'application/json'
                        }
                    })
                ).catch(e => console.log("Error Creating Conversation", e));
            }
        },
        onFailure: err => {
            console.log(`AUTHFAIL ${err}`, err.stack);
            console.log(err);
        }
    });
    callback(null, event);
};
