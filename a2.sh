apt update
apt install -y wget sudo gnupg2 software-properties-common git curl
wget -qO- https://adoptopenjdk.jfrog.io/adoptopenjdk/api/gpg/key/public|sudo apt-key add -
sudo add-apt-repository --yes https://adoptopenjdk.jfrog.io/adoptopenjdk/deb
sudo apt-get update
sudo apt-get install -y adoptopenjdk-8-hotspot
apt install -y maven
git clone https://github.com/nablarch/nablarch-example-web.git
mv nablarch-example-web root
cd root/nablarch-example-web
mvn generate-resources
mvn compile
mvn waitt:run