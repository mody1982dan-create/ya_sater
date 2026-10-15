// Import the functions you need from the SDKs you need

import { initializeApp } from "firebase/app";

import { getAnalytics } from "firebase/analytics";

// TODO: Add SDKs for Firebase products that you want to use

// https://firebase.google.com/docs/web/setup#available-libraries


// Your web app's Firebase configuration

// For Firebase JS SDK v7.20.0 and later, measurementId is optional

const firebaseConfig = {

apiKey: "AIzaSyB7b-eu4rNDFEBOukNXoK8KvpH3ndkiMbQ",

authDomain: "gtna-9d3f7.firebaseapp.com",

databaseURL: "https://gtna-9d3f7-default-rtdb.europe-west1.firebasedatabase.app",

projectId: "gtna-9d3f7",

storageBucket: "gtna-9d3f7.firebasestorage.app",

messagingSenderId: "846178958359",

appId: "1:846178958359:web:b03d1c0d6b160f3f66b052",

measurementId: "G-69XQBN3D4Z"

};


// Initialize Firebase

const app = initializeApp(firebaseConfig);

const analytics = getAnalytics(app);


