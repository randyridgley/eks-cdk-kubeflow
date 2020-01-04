import cdk = require('@aws-cdk/core');
import eks = require('@aws-cdk/aws-eks');
import s3 = require('@aws-cdk/aws-s3');
import lambda = require('@aws-cdk/aws-lambda');
import { AccountRootPrincipal, ManagedPolicy, Role } from '@aws-cdk/aws-iam';
import { Vpc, SubnetType, InstanceType, InstanceClass, InstanceSize } from '@aws-cdk/aws-ec2';

import { KubeflowCluster } from '../lib/kubeflow-cluster';
import { EKSConsole } from '../lib/eks-console';

import moment = require('moment');
import path = require('path');
import { ClusterAutoscaler } from '@arhea/aws-cdk-eks-cluster-autoscaler';

export class KubeflowStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'VPC', {
      maxAzs: 3,
      cidr: "10.0.0.0/16",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'private-eks',
          subnetType: SubnetType.PRIVATE,
        },
        {
          cidrMask: 24,
          name: 'public-alb-nat',
          subnetType: SubnetType.PUBLIC
        }
      ]
    });
    
    // first define the role
    const clusterAdmin = new Role(this, 'AdminRole', {
      assumedBy: new AccountRootPrincipal()
    });
    clusterAdmin.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'));
    clusterAdmin.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSServicePolicy'));

    // The code that defines your stack goes here
    const cluster = new eks.Cluster(this, 'KubeflowCluster', {
      mastersRole: clusterAdmin,
      vpc: vpc,
      outputClusterName: true,
      defaultCapacity: 1
    });

    // create a custom node group
    const ng = cluster.addCapacity('kubeflow-ng1', {
      instanceType: InstanceType.of(InstanceClass.M5, InstanceSize.LARGE),
      associatePublicIpAddress: false,
      bootstrapEnabled: true,
      desiredCapacity: 3,
      minCapacity: 3,
      maxCapacity: 6,
      mapRole: true
    });

    // create the cluster autoscaler instance
    const csa = new ClusterAutoscaler(this, 'demo-cluster-autoscaler', {
      cluster: cluster, // your EKS cluster
      nodeGroups: [ ng ] // a list of your node groups
    });

    const clusterBucket = new s3.Bucket(this, 'clusterBucket', {
      bucketName: this.makeBucketName("kubeflow-demo")
    });

    new EKSConsole(this, 'eksConsole', {
      vpc: vpc
    });

    const kfctlLayer = new lambda.LayerVersion(this,'KfctlLambdaLayer',{
      description: 'AWS Lambda Layer for the kfctl CLI',
      compatibleRuntimes: [lambda.Runtime.PROVIDED],
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/kfctl-layer/layer.zip')),
      license: 'Available under the MIT-0 license.',
      layerVersionName: 'lambda-layer-kfctl'
    });

    const kubectlLayer = new lambda.LayerVersion(this,'KubectlLambdaLayer',{
      description: 'AWS Lambda Layer for the kubectl CLI',
      compatibleRuntimes: [lambda.Runtime.PROVIDED],
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/kubectl-layer/layer.zip')),
      license: 'Available under the MIT-0 license.',
      layerVersionName: 'lambda-layer-kubectl'
    });

    new KubeflowCluster(this, 'KfCluster', {
      cluster,
      layers: [
        kfctlLayer,
        kubectlLayer
      ],
      configUrl: "https://raw.githubusercontent.com/kubeflow/manifests/v0.7-branch/kfdef/kfctl_aws.0.7.0.yaml",
      bucket: clusterBucket.bucketName,
      adminRole: clusterAdmin
    });
  }

  makeBucketName(bucketSuffix: string) : string {
    return cdk.Aws.ACCOUNT_ID + moment().format('YYYYMMDDhhmmss') + bucketSuffix;
  }
}

const app = new cdk.App();
new KubeflowStack(app, 'KubeflowStack');
