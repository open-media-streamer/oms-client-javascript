pipeline {
    agent any

    stages {
        stage('Build') {
            steps {
                echo "Building..:$GIT_COMMIT"
            }
        }
        stage('Test') {
            steps {
                echo 'Testing..'
            }
        }
        stage('Deploy') {
            steps {
                echo 'Deploying....'
            }
        }
    }
}