import '../configureAWS'; // tslint:disable-line no-import-side-effect
// ^ force setting of process.env.AWS_SDK_LOAD_CONFIG = '1'
// in a safe way that doesn't blow up if ~/.aws isn't present
